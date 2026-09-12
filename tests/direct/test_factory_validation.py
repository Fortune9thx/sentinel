"""
Direct-mode tests for SentinelFactory -- validation guard clauses, and the
withdraw_fees() recovery path.

Scope note: create_covenant's actual gl.deploy_contract call (spawning a
child Sentinel) is NOT exercised here. gltest's direct-mode WASI mock has no
default handler for cross-contract DeployContract calls. Every guard clause
below reverts BEFORE the deploy_contract call is ever reached, so it's fully
testable in direct mode; the success path (a real spawned, readable child
Sentinel) is integration-test-only -- see tests/integration/test_full_lifecycle.py.
"""

from gltest.direct import VMContext, create_test_addresses

from conftest import SENTINEL_FACTORY_PATH, SENTINEL_PATH, deploy_contract, to_hex


def _deploy_factory(vm, owner, creation_stake=0):
    vm.sender = owner
    sentinel_code = SENTINEL_PATH.read_text(encoding="utf-8")
    return deploy_contract(SENTINEL_FACTORY_PATH, vm, sentinel_code, creation_stake)


def test_factory_deploys_with_owner_and_stake():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=100)
        assert factory.get_creation_stake() == "100"
        assert factory.get_covenants_count() == 0
        assert factory.get_collected_fees() == "0"


def test_factory_requires_sentinel_code():
    vm = VMContext()
    with vm.activate():
        with vm.expect_revert("Missing Sentinel contract source"):
            deploy_contract(SENTINEL_FACTORY_PATH, vm, "", 0)


def test_create_covenant_rejects_insufficient_stake():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=100)
        vm.sender = alice
        vm.value = 50
        with vm.expect_revert("stake too low"):
            factory.create_covenant("API Service", "https://example.com/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_missing_name():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("service_name is required"):
            factory.create_covenant("", "https://example.com/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_bad_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("http(s)"):
            factory.create_covenant("API Service", "not-a-url", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_localhost_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("localhost/private/internal"):
            factory.create_covenant("API Service", "http://localhost:8080/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_loopback_ip_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("localhost/private/internal"):
            factory.create_covenant("API Service", "http://127.0.0.1/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_private_ip_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("localhost/private/internal"):
            factory.create_covenant("API Service", "http://10.0.0.5/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_decimal_encoded_loopback_ip_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        # 2130706433 is the decimal encoding of 127.0.0.1 -- a classic SSRF
        # bypass for naive string-based localhost blocklists.
        with vm.expect_revert("localhost/private/internal"):
            factory.create_covenant("API Service", "http://2130706433/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_embedded_credentials_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("localhost/private/internal"):
            factory.create_covenant("API Service", "http://user:pass@example.com/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_explicit_port_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("localhost/private/internal"):
            factory.create_covenant("API Service", "http://example.com:8080/status", "99.9% uptime", 1000, 3000)


def test_create_covenant_rejects_missing_spec():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("spec is required"):
            factory.create_covenant("API Service", "https://example.com/status", "", 1000, 3000)


def test_create_covenant_rejects_zero_slash_amount():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("slash_amount must be greater than zero"):
            factory.create_covenant("API Service", "https://example.com/status", "99.9% uptime", 0, 3000)


def test_create_covenant_rejects_min_bond_below_slash_amount():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("min_bond must be at least slash_amount"):
            factory.create_covenant("API Service", "https://example.com/status", "99.9% uptime", 1000, 500)


def test_get_owner_matches_deployer():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        assert factory.get_owner().lower() == to_hex(owner).lower()


# ------------------------------------------------------------------
# withdraw_fees() -- the factory-creation-fee recovery path
# ------------------------------------------------------------------

def test_withdraw_fees_only_owner():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        with vm.expect_revert("Only the factory owner"):
            factory.withdraw_fees()


def test_withdraw_fees_rejects_when_nothing_collected():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = owner
        with vm.expect_revert("No fees to withdraw"):
            factory.withdraw_fees()
