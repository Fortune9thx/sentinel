"""
Direct-mode tests for Sentinel construction and fund_bond() -- the
permissionless, auto-activating bond-funding path.
"""

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import SENTINEL_PATH, to_hex

SPEC = "99.9% uptime, 200ms p95 latency, JSON responses only."


def _deploy(vm, seller, slash_amount=1000, min_bond=3000):
    vm.sender = seller
    return deploy_contract(
        SENTINEL_PATH, vm, "API Status Service", "https://example.com/status", SPEC, slash_amount, min_bond
    )


def test_deploy_starts_pending_bond_with_zero_balance():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy(vm, seller)
        info = sentinel.get_covenant_info()
        assert info["status"] == "pending_bond"
        assert info["bond"] == "0"
        assert info["address_seller"].lower() == to_hex(seller).lower()


def test_deploy_rejects_min_bond_below_slash_amount():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        vm.sender = seller
        with vm.expect_revert("min_bond must be at least slash_amount"):
            deploy_contract(SENTINEL_PATH, vm, "Service", "https://example.com/status", SPEC, 1000, 500)


def test_deploy_rejects_bad_endpoint_url():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        vm.sender = seller
        with vm.expect_revert("endpoint_url must be"):
            deploy_contract(SENTINEL_PATH, vm, "Service", "not-a-url", SPEC, 1000, 3000)


def test_fund_bond_partial_stays_pending():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy(vm, seller)
        vm.sender = seller
        vm.value = 1000
        sentinel.fund_bond()
        info = sentinel.get_covenant_info()
        assert info["bond"] == "1000"
        assert info["status"] == "pending_bond"


def test_fund_bond_crossing_min_bond_activates_automatically():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy(vm, seller)
        vm.sender = seller
        vm.value = 3000
        sentinel.fund_bond()
        info = sentinel.get_covenant_info()
        assert info["bond"] == "3000"
        assert info["status"] == "active"


def test_fund_bond_is_permissionless():
    """Anyone -- not only the seller -- can top up a covenant's bond; more
    bond is strictly good for the buyers it protects."""
    vm = VMContext()
    seller, backer = create_test_addresses(2)
    with vm.activate():
        sentinel = _deploy(vm, seller)
        vm.sender = backer
        vm.value = 3000
        sentinel.fund_bond()
        assert sentinel.get_covenant_info()["status"] == "active"


def test_fund_bond_rejects_zero_value():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy(vm, seller)
        vm.sender = seller
        vm.value = 0
        with vm.expect_revert("Must send GEN"):
            sentinel.fund_bond()


def test_fund_bond_stays_available_while_exiting():
    """A generous late top-up should still be possible during the exit
    cooldown -- it can only ever help buyers, never used to game anything."""
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy(vm, seller)
        vm.sender = seller
        vm.value = 3000
        sentinel.fund_bond()
        sentinel.request_exit()
        vm.value = 500
        sentinel.fund_bond()
        assert sentinel.get_covenant_info()["bond"] == "3500"
