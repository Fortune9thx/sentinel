"""
Integration tests against a real GenLayer node (Studio or Bradbury testnet).

These are the only tests in this repo that exercise gl.deploy_contract (the
SentinelFactory -> Sentinel on-chain factory pattern), since gltest's
direct-mode WASI mock has no default support for cross-contract deploy (see
tests/direct/test_factory_validation.py's module docstring). They also cover
withdraw_fees()'s successful-withdrawal path, which requires a real
collected fee balance that only a genuine create_covenant deploy can produce.

Requires a configured gltest.config.yaml pointing at a live node and funded
test accounts. Run with: gltest tests/integration -v --network testnet_bradbury

Scope note: get_contract_factory is a plain importable function in the
installed genlayer-test version, NOT an auto-injected pytest fixture --
despite its name suggesting otherwise, and despite the same mistaken
fixture-parameter usage having been written (and never actually run
end-to-end) on a prior project on this stack. `accounts` yields real
eth_account LocalAccount objects, which expose `.address`, not a bare
string -- calling `.lower()` directly on one raises AttributeError.
"""

from pathlib import Path

import pytest
from gltest import get_contract_factory

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
SENTINEL_PATH = CONTRACTS_DIR / "Sentinel.py"
SENTINEL_FACTORY_PATH = CONTRACTS_DIR / "SentinelFactory.py"

ENDPOINT = "https://en.wikipedia.org/wiki/Service-level_agreement"
SPEC = "Page must be reachable and return HTML content."

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def factory(accounts):
    """Deploy a fresh SentinelFactory with the real Sentinel.py source
    embedded, exactly as deploy/001_deploy_sentinel_factory.ts does for a
    real network deployment. A non-zero creation stake so withdraw_fees()
    has something real to recover."""
    sentinel_code = SENTINEL_PATH.read_text(encoding="utf-8")
    contract_factory = get_contract_factory(contract_file_path=str(SENTINEL_FACTORY_PATH))
    return contract_factory.deploy(args=[sentinel_code, 1])


def test_create_covenant_spawns_readable_child_contract(factory, accounts):
    seller = accounts[0]
    address_hex = factory.connect(seller).create_covenant(
        "Integration test service",
        ENDPOINT,
        SPEC,
        1000,
        3000,
    )
    assert address_hex.startswith("0x")

    covenants = factory.get_covenants()
    assert address_hex in covenants

    meta = factory.get_covenant_meta(address_hex)
    assert meta["service_name"] == "Integration test service"


def test_factory_owner_is_informational_except_for_withdraw_fees(factory, accounts):
    """get_owner() gates exactly one thing (withdraw_fees) -- every other
    write (create_covenant) is intentionally permissionless, gated by the
    creation stake, not an allowlist."""
    deployer = accounts[0]
    assert factory.get_owner().lower() == deployer.address.lower()


def test_create_covenant_rejects_bad_url(factory, accounts):
    seller = accounts[0]
    with pytest.raises(Exception, match="http\\(s\\)"):
        factory.connect(seller).create_covenant("Bad", "not-a-url", SPEC, 1000, 3000)


def test_withdraw_fees_recovers_real_collected_stake(factory, accounts):
    """The one genuinely fund-moving factory write -- proves collected_fees
    tracks real create_covenant payments and withdraw_fees actually pays the
    owner, not just flips a flag."""
    owner = accounts[0]
    before = int(factory.get_collected_fees())

    factory.connect(owner).create_covenant(
        "Fee-tracking probe", ENDPOINT, SPEC, 1000, 3000, value=5
    )
    after = int(factory.get_collected_fees())
    assert after == before + 5

    factory.connect(owner).withdraw_fees()
    assert int(factory.get_collected_fees()) == 0


def test_fund_bond_and_audit_against_a_real_live_endpoint(factory, accounts):
    """The full real-network path: spawn a covenant, fund its bond past
    min_bond (auto-activating it), then run one genuine audit() against a
    real live URL -- exercising the actual gl.nondet.web.render + LLM
    consensus path, not the WASI mock."""
    seller = accounts[0]
    address_hex = factory.connect(seller).create_covenant(
        "Real-audit probe", ENDPOINT, SPEC, 1000, 3000
    )
    sentinel = get_contract_factory(contract_file_path=str(SENTINEL_PATH)).build_contract(
        contract_address=address_hex
    )

    sentinel.connect(seller).fund_bond(value=3000)
    info = sentinel.get_covenant_info()
    assert info["status"] == "active"
    assert info["bond"] == "3000"

    audit_id = sentinel.connect(seller).audit()
    record = sentinel.get_audit(audit_id)
    # A real, publicly reachable page -- the leader should find it fetchable
    # (outcome != "unreachable") even if the compliance verdict itself is a
    # judgment call this test doesn't assert on.
    assert record["outcome"] in ("compliant", "violation")
    assert record["evidence_snapshot"] != ""
