"""
Direct-mode tests for request_exit()/withdraw_remaining_bond() -- the
seller's bounded, permissionless path to recover unslashed bond, and the
anti-gaming guarantee that audits (and slashing) remain live throughout the
whole cooldown window.
"""

import json

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import SENTINEL_PATH, warp_now

SPEC = "99.9% uptime."
ENDPOINT = "https://example.com/status"
EXIT_COOLDOWN_SECONDS = 259200


def _wrapped_json(payload: dict) -> str:
    return f"Analysis:\n```json\n{json.dumps(payload)}\n```"


def _deploy_active(vm, seller, slash_amount=1000, min_bond=3000):
    vm.sender = seller
    sentinel = deploy_contract(SENTINEL_PATH, vm, "Service", ENDPOINT, SPEC, slash_amount, min_bond)
    # Warp to a known, fixed "now" strictly before every breach-triggering
    # audit's timestamp in this file (all "2026-01-01T00:..."). Without
    # this, a beneficiary registered right after deploy would register at
    # gltest's default frozen deploy-time clock instead, which can land
    # AFTER the breach and wrongly disqualify them from eligibility.
    warp_now(vm, "2025-12-31T00:00:00Z")
    vm.value = min_bond
    sentinel.fund_bond()
    return sentinel


def test_request_exit_only_seller():
    vm = VMContext()
    seller, stranger = create_test_addresses(2)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        vm.sender = stranger
        with vm.expect_revert("Only the seller"):
            sentinel.request_exit()


def test_withdraw_before_cooldown_rejected():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        warp_now(vm, "2026-01-01T00:00:00Z")
        vm.sender = seller
        sentinel.request_exit()
        with vm.expect_revert("can only be withdrawn"):
            sentinel.withdraw_remaining_bond()


def test_withdraw_after_cooldown_recovers_bond():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        warp_now(vm, "2026-01-01T00:00:00Z")
        vm.sender = seller
        sentinel.request_exit()

        warp_now(vm, "2026-01-04T00:00:01Z")  # 72h + 1s later
        vm.sender = seller
        sentinel.withdraw_remaining_bond()

        info = sentinel.get_covenant_info()
        assert info["bond"] == "0"
        assert info["status"] == "exited"


def test_audit_and_slashing_remain_live_during_exit_cooldown():
    """A seller mid-breach-streak cannot dodge it by requesting exit --
    audits stay callable, and the bond stays slashable, for the entire
    cooldown."""
    vm = VMContext()
    seller, buyer = create_test_addresses(2)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        vm.sender = buyer
        sentinel.register_as_beneficiary()

        warp_now(vm, "2026-01-01T00:00:00Z")
        vm.sender = seller
        vm.value = 0
        sentinel.request_exit()

        for i in range(3):
            vm.clear_mocks()
            vm.mock_web(r"example\.com/status", {"method": "GET", "status": 200, "body": "error"})
            vm.mock_llm(
                r"independent auditor",
                _wrapped_json({"compliant": False, "confidence": "0.9", "reasoning": "Down."}),
            )
            warp_now(vm, f"2026-01-01T00:{i * 10:02d}:00Z")
            vm.sender = seller
            vm.value = 0
            sentinel.audit()

        info = sentinel.get_covenant_info()
        assert info["total_breaches"] == "1"
        assert info["bond"] == "2000"  # slashed even while EXITING


def test_double_exit_request_rejected():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        vm.sender = seller
        sentinel.request_exit()
        with vm.expect_revert("not active"):
            sentinel.request_exit()


def test_withdraw_without_requesting_exit_rejected():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        vm.sender = seller
        with vm.expect_revert("Exit has not been requested"):
            sentinel.withdraw_remaining_bond()
