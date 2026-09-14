# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json
from datetime import datetime
from urllib.parse import urlsplit
import ipaddress

import genlayer as gl
from genlayer.types import *
from genlayer.storage import DynArray, TreeMap

MAX_URL_LEN = 500
MAX_NAME_LEN = 140
MAX_SPEC_LEN = 1500


def _consensus_now() -> int:
    """Unix timestamp via gl.message.raw["datetime"] -- see Sentinel.py's
    identical copy of this helper for why gl.vm.get_timestamp() is avoided
    (confirmed broken live on Studio Devnet: raises `SystemError: 2: inval`)."""
    raw = gl.message.raw["datetime"]
    return int(datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp())


def _normalize_address(addr: str) -> str:
    """TreeMap keys and equality comparisons against caller-supplied address
    strings use this everywhere -- see Sentinel.py's copy of this helper for
    the full rationale (Address.as_hex is an EIP-55-style checksum; comparing
    it against raw unnormalized caller input is a real, confirmed GenLayer
    rejection pattern)."""
    return addr.strip().lower()


def _is_safe_endpoint_url(url_s: str) -> bool:
    """SSRF guard -- see Sentinel.py's identical copy of this helper for the
    full rationale. Duplicated rather than imported because each contract
    file is deployed as a self-contained source string, matching every other
    duplicated helper in this file (_consensus_now, _normalize_address,
    _Recipient)."""
    try:
        parts = urlsplit(url_s)
    except ValueError:
        return False
    if parts.username or parts.password:
        return False
    if parts.port is not None:
        return False
    host = (parts.hostname or "").lower()
    if not host:
        return False
    if host == "localhost" or host.endswith(".localhost"):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return False
    if ip is None and host.replace(".", "").isdigit():
        return False
    return True


@gl.evm.contract_interface
class _Recipient:
    """Nameless-transfer interface used to pay out native GEN to a wallet."""

    class View:
        pass

    class Write:
        pass


class SentinelFactory(gl.contract.Contract):
    """
    Registry + on-chain factory for Sentinel covenants.

    Deploys a fresh `Sentinel` contract instance per covenant via
    gl.contract.deploy, mirroring the same verified factory pattern used
    across every prior GenLayer project on this stack. Registry metadata is
    intentionally read-only creation-time data (service name, endpoint,
    spec, seller) -- live status/bond/audit state is never mirrored here and
    must be read directly from the Sentinel contract, since audit() changes
    that state continuously after deployment and this contract has no
    reliable way to be pushed updates from it (inline cross-contract writes
    are confirmed to silently no-op on Bradbury).

    Every write that spawns or reads a covenant is permissionless,
    economically gated by the creation stake and the covenant's own bond
    rather than an admin allowlist -- registering a covenant (via either
    create_covenant or register_covenant) never requires owner approval.
    `owner` gates exactly two things: withdraw_fees(), recovering
    accumulated creation stakes so they are never permanently stranded here
    with no recovery path, and verify_covenant() -- see its own docstring
    for why that one exists and what it does and does NOT change about
    permissionless registration.

    verified_covenants tracks a SEPARATE trust signal layered on top of the
    registry, not a gate on being IN the registry. Every covenant deployed
    via create_covenant() is auto-verified at registration time, because the
    factory deployed that exact bytecode itself -- no review needed, it's
    cryptographically certain. A covenant registered via register_covenant()
    (the deploy-then-register workaround; see its own docstring for why
    that path exists) starts unverified and stays that way unless the owner
    later calls verify_covenant() on it -- see docs/AUDIT.md for the full
    reasoning behind this two-tier design.
    """

    sentinel_code: str
    creation_stake: u256
    owner: Address
    collected_fees: u256
    covenant_addresses: DynArray[str]
    # address_hex(normalized) -> JSON {address, service_name, endpoint_url,
    #                                   spec, seller, created_at, creation_stake}
    covenant_meta: TreeMap[str, str]
    # normalized_address -> "1" once verified (see verify_covenant's docstring)
    verified_covenants: TreeMap[str, str]

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
        if not _is_safe_endpoint_url(url_s):
            raise gl.vm.UserError("endpoint_url must not target a localhost/private/internal address.")
        if not spec or len(spec) > MAX_SPEC_LEN:
            raise gl.vm.UserError(f"spec is required and must be at most {MAX_SPEC_LEN} characters.")
        if int(slash_amount) <= 0:
            raise gl.vm.UserError("slash_amount must be greater than zero.")
        if int(min_bond) < int(slash_amount):
            raise gl.vm.UserError("min_bond must be at least slash_amount.")

        registered = len(self.covenant_addresses)
        contract_address = gl.contract.deploy(
            code=self.sentinel_code.encode("utf-8"),
            args=[service_name, url_s, spec, slash_amount, min_bond],
            salt_nonce=u256(registered + 1),
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
        norm = _normalize_address(address_hex)
        self.covenant_meta[norm] = json.dumps(meta)
        # This is the ONLY code path in this contract that can be certain,
        # not merely convinced, that the deployed bytecode is exactly
        # sentinel_code -- gl.contract.deploy() above deployed it directly
        # from this factory's own storage. No review, no owner action, no
        # judgment call: automatic verification is correct here precisely
        # because nothing needs to be trusted.
        self.verified_covenants[norm] = "1"
        return address_hex

    @gl.public.write.payable
    def register_covenant(self, address: str) -> str:
        """Registers an already-deployed Sentinel covenant, bypassing the
        internal gl.contract.deploy() call create_covenant() uses --
        Consensus v0.6's internal-message fee-allocation system currently
        rejects that path (`fee no_matching_allocation # internal`,
        confirmed live on Studio Devnet across multiple independent fee
        configurations tried, an unresolved upstream platform gap, not a bug
        in this contract).

        DISCLOSED LIMITATION: GenVM currently exposes no in-contract
        primitive to verify that `address` is genuinely running this
        factory's own embedded `sentinel_code` (no code-hash/bytecode
        comparison call exists in the SDK as of this writing). This method
        independently reads the target's own live state via a real
        cross-contract view call and requires it to look and be positioned
        exactly like a freshly-deployed, never-yet-funded Sentinel instance
        (status == pending_bond, zero bond, zero audits, zero breaches) and
        requires the caller to BE that covenant's own reported seller -- this
        closes the case where a random third party registers an unrelated or
        stale contract, and forces any forgery to be a *freshly-deployed*
        contract shaped exactly like a brand-new covenant, not an
        already-fabricated fake history. On top of that, the target's
        reported service_name/endpoint_url/spec are independently validated
        against the exact same bounds and SSRF-safety checks
        Sentinel.__init__ enforces on every genuine covenant -- a real
        Sentinel could never actually hold an oversized or unsafe value
        there, so a target reporting one is rejected outright rather than
        having that unsafe data copied into this registry's own public
        metadata. It does NOT, and structurally cannot with
        currently-available primitives, cryptographically guarantee the
        registered contract's audit()/fund_bond() logic is the real
        Sentinel implementation rather than a look-alike that later
        self-reports fabricated audit outcomes -- GenVM has no in-contract
        way to compare another contract's actual bytecode/source hash. This
        is the accepted, explicitly-disclosed residual tradeoff of the
        create_covenant-bypass workaround above; see docs/AUDIT.md.

        Because that residual gap can't be closed by verification logic
        alone, a covenant registered here enters covenant_addresses
        immediately (registration itself stays fully permissionless -- no
        one needs the owner's approval to post a covenant) but starts
        UNVERIFIED: it does not appear in verified_covenants until the
        factory owner separately calls verify_covenant() on it. This is a
        second, independent trust SIGNAL layered on top of an unchanged
        permissionless registry, not a gate on being in it -- see
        verify_covenant()'s own docstring."""
        if gl.message.value < self.creation_stake:
            raise gl.vm.UserError(
                f"Creation stake too low: sent {gl.message.value}, requires {self.creation_stake}"
            )
        target = Address(address)
        address_hex = target.as_hex
        norm = _normalize_address(address_hex)
        if self.covenant_meta.get(norm, ""):
            raise gl.vm.UserError("Covenant already registered.")

        proxy = gl.contract.get_at(target)
        info = proxy.view().get_covenant_info()
        if not isinstance(info, dict) or "status" not in info or "address_seller" not in info:
            raise gl.vm.UserError("Address does not respond as a valid Sentinel covenant.")
        if _normalize_address(info.get("address_seller", "")) != _normalize_address(gl.message.sender_address.as_hex):
            raise gl.vm.UserError("Only the covenant's own seller may register it.")
        if info.get("status") != "pending_bond":
            raise gl.vm.UserError("Only a freshly-deployed, unfunded covenant can be registered.")
        if info.get("bond", "0") != "0" or info.get("audit_count", "0") != "0" or info.get("total_breaches", "0") != "0":
            raise gl.vm.UserError("Covenant does not look freshly deployed.")

        # A target that passes every check above is still an ARBITRARY
        # contract controlled entirely by whoever deployed it -- nothing
        # stops it from reporting a service_name/endpoint_url/spec that
        # violates the exact same bounds Sentinel.__init__ and
        # create_covenant() enforce on every genuine covenant (oversized
        # strings, an unsafe/SSRF-targeting endpoint_url, control
        # characters). A real Sentinel instance could never actually hold
        # such values -- its own constructor rejects them -- so if a
        # reported value fails these checks, the target is definitely not
        # running genuine Sentinel logic and must be rejected outright,
        # rather than copying unsafe/malformed data into this registry's own
        # public metadata for the frontend to render or link out to.
        reported_name = info.get("service_name", "")
        reported_url = info.get("endpoint_url", "")
        reported_spec = info.get("spec", "")
        if not reported_name or len(reported_name) > MAX_NAME_LEN:
            raise gl.vm.UserError("Reported service_name is invalid for a genuine Sentinel covenant.")
        if (
            not reported_url
            or len(reported_url) > MAX_URL_LEN
            or not (reported_url.startswith("http://") or reported_url.startswith("https://"))
            or not _is_safe_endpoint_url(reported_url)
        ):
            raise gl.vm.UserError("Reported endpoint_url is invalid for a genuine Sentinel covenant.")
        if not reported_spec or len(reported_spec) > MAX_SPEC_LEN:
            raise gl.vm.UserError("Reported spec is invalid for a genuine Sentinel covenant.")

        self.covenant_addresses.append(address_hex)
        amount = int(gl.message.value)
        self.collected_fees = u256(int(self.collected_fees) + amount)
        meta = {
            "address": address_hex,
            "service_name": info.get("service_name", ""),
            "endpoint_url": info.get("endpoint_url", ""),
            "spec": info.get("spec", ""),
            "slash_amount": info.get("slash_amount", "0"),
            "min_bond": info.get("min_bond", "0"),
            "seller": info.get("address_seller", ""),
            "created_at": str(_consensus_now()),
            "creation_stake": str(amount),
        }
        self.covenant_meta[norm] = json.dumps(meta)
        return address_hex

    @gl.public.write
    def verify_covenant(self, address: str) -> None:
        """Owner-only. This is the second half of the two-tier trust model
        register_covenant()'s own docstring describes: GenVM has no
        in-contract way to prove a register_covenant()-admitted address is
        genuinely running unmodified Sentinel logic, so that verification
        can never be fully automated the way create_covenant()'s auto-verify
        is (see create_covenant()'s own comment -- deploying the code
        directly makes that case cryptographically certain, needing no
        review). For a register_covenant() entry the best available
        guarantee is a human -- the one party with a reputational stake in
        the registry being trustworthy -- reviewing the deployed contract's
        actual source before marking it verified (e.g. diffing it against
        this factory's own sentinel_code off-chain). This does NOT gate
        registration itself: an unverified covenant is still fully live,
        fully listed, fully functional -- verify_covenant only flips a
        second, additive trust signal the frontend can surface (e.g. a
        "verified" badge) without ever hiding or blocking an unverified
        entry. Idempotent and reversible only in the sense that calling it
        again is a harmless no-op; there is deliberately no unverify() --
        once a human has actually checked the code, that fact doesn't
        change, only the covenant's own runtime behavior could (and that is
        exactly what audit() -- not this method -- exists to keep
        checking)."""
        if gl.message.sender_address.as_hex != self.owner.as_hex:
            raise gl.vm.UserError("Only the factory owner may verify a covenant.")
        norm = _normalize_address(address)
        if not self.covenant_meta.get(norm, ""):
            raise gl.vm.UserError("Unknown covenant address.")
        self.verified_covenants[norm] = "1"

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
        norm = _normalize_address(address)
        raw = self.covenant_meta.get(norm, "")
        if not raw:
            raise gl.vm.UserError("Unknown covenant address.")
        meta = json.loads(raw)
        meta["verified"] = bool(self.verified_covenants.get(norm, ""))
        return meta

    @gl.public.view
    def is_covenant_verified(self, address: str) -> bool:
        return bool(self.verified_covenants.get(_normalize_address(address), ""))

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
