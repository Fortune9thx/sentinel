"""
Direct-mode test fixtures for Sentinel contracts.

Applies one Windows-only monkeypatch documented from prior GenLayer projects
on this machine: gltest's direct-mode loader unlinks a temp file that is
still open via os.dup2 on this platform, raising PermissionError (harmless
on POSIX, where the same test suite runs clean). This patch never touches
contract code or the real SDK -- it only relaxes cleanup of a test-harness
temp file.
"""

import os
import sys
from pathlib import Path

import pytest
from gltest.direct import deploy_contract as _raw_deploy_contract

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
SENTINEL_PATH = CONTRACTS_DIR / "Sentinel.py"
SENTINEL_FACTORY_PATH = CONTRACTS_DIR / "SentinelFactory.py"

_real_unlink = os.unlink


def _safe_unlink(path, *args, **kwargs):
    try:
        _real_unlink(path, *args, **kwargs)
    except PermissionError:
        pass


os.unlink = _safe_unlink


@pytest.fixture
def sentinel_source() -> str:
    return SENTINEL_PATH.read_text(encoding="utf-8")


def _find_real_address_cls():
    """create_test_addresses()/create_address() fall back to plain bytes in
    this environment because `genlayer` isn't on sys.path until a contract
    has actually been deployed once (gltest wires SDK paths lazily inside
    load_contract_class). Address.as_hex is NOT plain lowercase hex -- it is
    an EIP-55 Keccak256 checksum, so a naive "0x" + bytes.hex() fallback
    silently produces the WRONG key and every TreeMap[str, str] lookup keyed
    by an address misses. Import the real Address class straight from the
    cached SDK so tests key backers exactly the way the contract itself
    does."""
    cache_root = Path.home() / ".cache" / "gltest-direct" / "extracted"
    for candidate in cache_root.glob("**/genlayer/py/types.py"):
        sdk_root = candidate.parents[2]
        if str(sdk_root) not in sys.path:
            sys.path.insert(0, str(sdk_root))
        from genlayer.py.types import Address
        return Address
    return None


_AddressCls = None


def warp_now(vm, iso_timestamp: str) -> None:
    """vm.warp() alone does not move a contract's notion of "now" once
    already deployed: gltest's VMContext._refresh_gl_message (direct/vm.py)
    updates gl.message_raw's sender/origin/value on every vm.sender/vm.value
    change, but never touches gl.message_raw['datetime'] -- and the method
    that would build a fresh copy including it, get_message_raw(), is dead
    code, never called anywhere in the installed gltest package. So
    gl.message_raw["datetime"], which Sentinel._consensus_now() reads by
    deliberate design instead of Python's own datetime.now(), stays frozen
    at whatever it was when the contract was first imported. Patched here,
    scoped to tests only, matching the same gap documented in every prior
    GenLayer project built on this stack."""
    vm.warp(iso_timestamp)
    gl = sys.modules.get("genlayer.gl")
    if gl is not None and getattr(gl, "message_raw", None) is not None:
        gl.message_raw["datetime"] = iso_timestamp


def deploy_contract(contract_path, vm, *args, **kwargs):
    """Wraps gltest.direct.deploy_contract, always pinning sdk_version to the
    known-good, fully-cached v0.2.16 build matching this contract's own
    `Depends` header hash. Without this, gltest's auto-version-detection
    tries to resolve GitHub's "latest" release first -- confirmed, dated gap
    from a prior GenLayer project on this stack: that resolution fails under
    GitHub API rate-limiting (or when "latest" no longer ships the expected
    asset name) and falls back to an incomplete/corrupt local cache bucket,
    producing a WASM-level "unexpected end of memory" error at contract-load
    time that has nothing to do with the contract's own code. Pinning here
    once means every test file gets the fix without touching each call site."""
    kwargs.setdefault("sdk_version", "v0.2.16")
    return _raw_deploy_contract(contract_path, vm, *args, **kwargs)


def to_hex(addr) -> str:
    """Normalize a create_test_addresses()/create_address() value (real
    Address or raw bytes fallback) to the exact checksummed 0x-hex string
    the contract's own `gl.message.sender_address.as_hex` produces."""
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    global _AddressCls
    if _AddressCls is None:
        _AddressCls = _find_real_address_cls()
    if _AddressCls is not None:
        return _AddressCls(addr).as_hex
    return "0x" + addr.hex()
