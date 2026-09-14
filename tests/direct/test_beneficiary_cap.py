"""
Direct-mode test for register_as_beneficiary()'s MAX_BENEFICIARIES cap.

Registration is free and permissionless by design (see the constant's own
docstring in Sentinel.py for why "proof of being a real customer" isn't
something a contract can check), but left fully unbounded it turns
_record_violation()'s per-breach eligibility scan -- which iterates every
registered beneficiary on every violating/escalated audit -- into an
unbounded loop a free Sybil flood could grief into unusable. This test
proves the cap actually rejects registration once full, rather than just
existing as an unused constant.
"""

from gltest.direct import VMContext, create_test_addresses

from conftest import SENTINEL_PATH, deploy_contract

ENDPOINT = "https://example.com/status"
SPEC = "99.9% uptime."

# Mirrors Sentinel.py's own MAX_BENEFICIARIES so this test breaks loudly (a
# clear assertion mismatch) rather than silently if the constant ever
# changes without this test being updated alongside it.
MAX_BENEFICIARIES = 500


def _deploy_active(vm, seller, slash_amount=1000, min_bond=3000):
    vm.sender = seller
    sentinel = deploy_contract(SENTINEL_PATH, vm, "Service", ENDPOINT, SPEC, slash_amount, min_bond)
    vm.value = min_bond
    sentinel.fund_bond()
    return sentinel


def test_registration_beyond_the_cap_is_rejected():
    vm = VMContext()
    seller, = create_test_addresses(1)
    buyers = create_test_addresses(MAX_BENEFICIARIES + 1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)

        for buyer in buyers[:MAX_BENEFICIARIES]:
            vm.sender = buyer
            sentinel.register_as_beneficiary()

        assert sentinel.get_covenant_info()["beneficiary_count"] == MAX_BENEFICIARIES

        vm.sender = buyers[MAX_BENEFICIARIES]
        with vm.expect_revert("Beneficiary registration is full"):
            sentinel.register_as_beneficiary()
