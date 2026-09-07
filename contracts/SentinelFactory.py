# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from datetime import datetime

from genlayer import *
import genlayer.gl as gl

MAX_URL_LEN = 500
MAX_NAME_LEN = 140
MAX_SPEC_LEN = 1500


def _consensus_now() -> int:
    """Unix timestamp from the transaction's own message context (identical
    for every validator), not each node's local wall clock."""
    raw = gl.message_raw["datetime"]
    return int(datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp())


def _normalize_address(addr: str) -> str:
    """TreeMap keys and equality comparisons against caller-supplied address
    strings use this everywhere -- see Sentinel.py's copy of this helper for
    the full rationale (Address.as_hex is an EIP-55-style checksum; comparing
    it against raw unnormalized caller input is a real, confirmed GenLayer
    rejection pattern)."""
    return addr.strip().lower()


@gl.evm.contract_interface
class _Recipient:
    """Nameless-transfer interface used to pay out native GEN to a wallet."""

    class View:
        pass

    class Write:
        pass


class SentinelFactory(gl.Contract):
    """
    Registry + on-chain factory for Sentinel covenants.

    Deploys a fresh `Sentinel` contract instance per covenant via
    gl.deploy_contract, mirroring the same verified factory pattern used
    across every prior GenLayer project on this stack. Registry metadata is
    intentionally read-only creation-time data (service name, endpoint,
    spec, seller) -- live status/bond/audit state is never mirrored here and
    must be read directly from the Sentinel contract, since audit() changes
    that state continuously after deployment and this contract has no
    reliable way to be pushed updates from it (inline cross-contract writes
    are confirmed to silently no-op on Bradbury).

    Every write that spawns or reads a covenant is permissionless,
    economically gated by the creation stake and the covenant's own bond
    rather than an admin allowlist -- `owner` gates exactly one thing, and
    only one thing: withdraw_fees(), recovering accumulated creation stakes
    so they are never permanently stranded in this contract with no
    recovery path.
    """

    sentinel_code: str
    creation_stake: u256
    owner: Address
    collected_fees: u256
    covenant_addresses: DynArray[str]
    # address_hex(normalized) -> JSON {address, service_name, endpoint_url,
    #                                   spec, seller, created_at, creation_stake}
    covenant_meta: TreeMap[str, str]

    def __init__(self, sentinel_code: str, creation_stake: u256):
        if not sentinel_code:
            raise gl.vm.UserError("Missing Sentinel contract source code.")
        self.sentinel_code = sentinel_code
        self.creation_stake = creation_stake
        self.owner = gl.message.sender_address
        self.collected_fees = u256(0)

    @gl.public.write.payable
    def create_covenant(
        self,
        service_name: str,
        endpoint_url: str,
        spec: str,
        slash_amount: u256,
        min_bond: u256,
    ) -> str:
        if gl.message.value < self.creation_stake:
            raise gl.vm.UserError(
                f"Creation stake too low: sent {gl.message.value}, requires {self.creation_stake}"
            )
        if not service_name or len(service_name) > MAX_NAME_LEN:
            raise gl.vm.UserError(f"service_name is required and must be at most {MAX_NAME_LEN} characters.")
        url_s = endpoint_url.strip()
        if not url_s or len(url_s) > MAX_URL_LEN or not (url_s.startswith("http://") or url_s.startswith("https://")):
            raise gl.vm.UserError(f"endpoint_url must be a non-empty http(s) URL, at most {MAX_URL_LEN} characters.")
        if not spec or len(spec) > MAX_SPEC_LEN:
            raise gl.vm.UserError(f"spec is required and must be at most {MAX_SPEC_LEN} characters.")
        if int(slash_amount) <= 0:
            raise gl.vm.UserError("slash_amount must be greater than zero.")
        if int(min_bond) < int(slash_amount):
            raise gl.vm.UserError("min_bond must be at least slash_amount.")

        registered = len(self.covenant_addresses)
        contract_address = gl.deploy_contract(
            code=self.sentinel_code.encode("utf-8"),
            args=[service_name, url_s, spec, slash_amount, min_bond],
            salt_nonce=registered + 1,
        )
        address_hex = contract_address.as_hex
        self.covenant_addresses.append(address_hex)

        amount = int(gl.message.value)
        self.collected_fees = u256(int(self.collected_fees) + amount)

        meta = {
            "address": address_hex,
            "service_name": service_name,
            "endpoint_url": url_s,
            "spec": spec,
            "slash_amount": str(int(slash_amount)),
            "min_bond": str(int(min_bond)),
            "seller": gl.message.sender_address.as_hex,
            "created_at": str(_consensus_now()),
            "creation_stake": str(amount),
        }
        self.covenant_meta[_normalize_address(address_hex)] = json.dumps(meta)
        return address_hex

    @gl.public.write
    def withdraw_fees(self) -> None:
        if gl.message.sender_address.as_hex != self.owner.as_hex:
            raise gl.vm.UserError("Only the factory owner may withdraw collected fees.")
        amount = int(self.collected_fees)
        if amount == 0:
            raise gl.vm.UserError("No fees to withdraw.")
        # Effects before interaction.
        self.collected_fees = u256(0)
        _Recipient(self.owner).emit_transfer(value=u256(amount))

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def get_creation_stake(self) -> str:
        return str(int(self.creation_stake))

    @gl.public.view
    def get_collected_fees(self) -> str:
        return str(int(self.collected_fees))

    @gl.public.view
    def get_covenants(self) -> list[str]:
        return list(self.covenant_addresses)

    @gl.public.view
    def get_covenants_count(self) -> int:
        return len(self.covenant_addresses)

    @gl.public.view
    def get_covenants_page(self, offset: int, limit: int) -> list[str]:
        if offset < 0 or limit <= 0:
            return []
        addresses = list(self.covenant_addresses)
        return addresses[offset : offset + limit]

    @gl.public.view
    def get_covenant_meta(self, address: str) -> dict:
        raw = self.covenant_meta.get(_normalize_address(address), "")
        if not raw:
            raise gl.vm.UserError("Unknown covenant address.")
        return json.loads(raw)

    @gl.public.view
    def get_covenants_by_seller(self, seller_address: str) -> list[str]:
        target = _normalize_address(seller_address)
        matches = []
        for address_hex in self.covenant_addresses:
            raw = self.covenant_meta.get(_normalize_address(address_hex), "")
            if not raw:
                continue
            meta = json.loads(raw)
            if _normalize_address(meta.get("seller", "")) == target:
                matches.append(address_hex)
        return matches
