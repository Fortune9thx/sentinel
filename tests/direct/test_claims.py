"""
Direct-mode tests for claim_slash_share() -- the pull-based payout for a
confirmed breach's eligible beneficiaries.
"""

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import SENTINEL_PATH, to_hex, warp_now

SPEC = "99.9% uptime."
ENDPOINT = "https://example.com/status"


def _web(body: str) -> dict:
    return {"method": "GET", "status": 200, "body": body}


def _wrapped_json(payload: dict) -> str:
    import json
    return f"Analysis:\n```json\n{json.dumps(payload)}\n```"


def _deploy_active(vm, seller, slash_amount=1000, min_bond=3000):
    vm.sender = seller
    sentinel = deploy_contract(SENTINEL_PATH, vm, "Service", ENDPOINT, SPEC, slash_amount, min_bond)
    # Warp to a known, fixed "now" strictly before every breach-triggering
    # audit's timestamp in this file (all "2026-01-01T00:..."). Without
    # this, beneficiaries below register at gltest's default frozen
    # deploy-time clock (whatever real date the test happened to run,
    # unrelated to 2026-01-01), which can land AFTER the breach and wrongly
    # disqualify them from eligibility.
    warp_now(vm, "2025-12-31T00:00:00Z")
    vm.value = min_bond
    sentinel.fund_bond()
    return sentinel


def _trigger_breach(vm, sentinel, seller):
    for i in range(3):
        vm.clear_mocks()
        vm.mock_web(r"example\.com/status", _web("error"))
        vm.mock_llm(
            r"independent auditor",
            _wrapped_json({"compliant": False, "confidence": "0.9", "reasoning": "Down."}),
        )
        warp_now(vm, f"2026-01-01T00:{i * 10:02d}:00Z")
        vm.sender = seller
        vm.value = 0
        sentinel.audit()


def test_claim_pays_equal_share_and_marks_claimed():
    vm = VMContext()
    seller, alice, bob = create_test_addresses(3)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        vm.sender = alice
        sentinel.register_as_beneficiary()
        vm.sender = bob
        sentinel.register_as_beneficiary()

        _trigger_breach(vm, sentinel, seller)

        assert sentinel.get_claimable("0", to_hex(alice)) == "500"

        vm.sender = alice
        sentinel.claim_slash_share("0")
        assert sentinel.is_claimed("0", to_hex(alice)) is True
        assert sentinel.get_claimable("0", to_hex(alice)) == "0"

        # Bob's share is untouched by Alice's claim.
        assert sentinel.get_claimable("0", to_hex(bob)) == "500"


def test_double_claim_rejected():
    vm = VMContext()
    seller, alice = create_test_addresses(2)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        vm.sender = alice
        sentinel.register_as_beneficiary()
        _trigger_breach(vm, sentinel, seller)

        vm.sender = alice
        sentinel.claim_slash_share("0")
        with vm.expect_revert("Already claimed"):
            sentinel.claim_slash_share("0")


def test_non_eligible_caller_cannot_claim():
    vm = VMContext()
    seller, alice, stranger = create_test_addresses(3)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        vm.sender = alice
        sentinel.register_as_beneficiary()
        _trigger_breach(vm, sentinel, seller)

        vm.sender = stranger
        with vm.expect_revert("not an eligible beneficiary"):
            sentinel.claim_slash_share("0")


def test_claim_on_breach_with_no_pool_rejected():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        # No beneficiaries registered -- breach logs but slashes nothing.
        _trigger_breach(vm, sentinel, seller)

        vm.sender = seller
        with vm.expect_revert("No eligible beneficiaries"):
            sentinel.claim_slash_share("0")
