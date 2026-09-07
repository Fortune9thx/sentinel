"""
Direct-mode tests for Sentinel.audit() -- the Intelligent Contract heart.

Scope note: audit() fetches the live endpoint via a single gl.nondet.web.render
call inside the leader closure passed to gl.vm.run_nondet_unsafe, matching the
one-nondet-call-per-method rule genvm-lint enforces. Covered here against the
WASI mock's vm.mock_web/vm.mock_llm: the fail-closed unreachable path, the
confidence-threshold fail-closed path, the consecutive-violation streak, and
the resulting breach/slash/claims-pool mechanics.
"""

import json

from gltest.direct import VMContext, create_test_addresses

from conftest import SENTINEL_PATH, deploy_contract, to_hex, warp_now

SPEC = "99.9% uptime, JSON responses only, no error codes in the body."
ENDPOINT = "https://example.com/status"
START = "2026-01-01T00:00:00Z"


def _web(body: str) -> dict:
    return {"method": "GET", "status": 200, "body": body}


def _wrapped_json(payload: dict) -> str:
    """LLM responses are rarely bare JSON in practice -- wrap it in prose the
    way a real model would, forcing _parse_json_object's brace-stripping to
    actually do work rather than relying on the mock's own auto-parse."""
    return f"Here is my analysis.\n```json\n{json.dumps(payload)}\n```\nEnd of response."


def _deploy_active(vm, seller, slash_amount=1000, min_bond=3000):
    vm.sender = seller
    sentinel = deploy_contract(
        SENTINEL_PATH, vm, "API Status Service", ENDPOINT, SPEC, slash_amount, min_bond
    )
    warp_now(vm, START)
    vm.value = min_bond
    sentinel.fund_bond()
    return sentinel


def _mock_endpoint(vm, body):
    vm.mock_web(r"example\.com/status", _web(body))


def _mock_verdict(vm, compliant, confidence, reasoning="Observed live."):
    vm.mock_llm(
        r"independent auditor",
        _wrapped_json({"compliant": compliant, "confidence": confidence, "reasoning": reasoning}),
    )


def test_audit_compliant_resets_streak_and_records_outcome():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        _mock_endpoint(vm, '{"status": "ok"}')
        _mock_verdict(vm, True, "0.9")
        vm.sender = seller
        audit_id = sentinel.audit()

        record = sentinel.get_audit(audit_id)
        assert record["outcome"] == "compliant"
        assert record["compliant"] is True
        assert record["confidence"] == "0.9"

        info = sentinel.get_covenant_info()
        assert info["consecutive_failures"] == "0"
        assert info["audit_count"] == "1"


def test_audit_fails_closed_when_endpoint_unreachable():
    """No mock_web registered -- the WASI mock returns an empty body for any
    unmocked URL. The audit must record UNREACHABLE, never call the LLM,
    and must NOT count as a violation on its own (a single unreachable
    fetch is not evidence the seller's service is actually down)."""
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        vm.sender = seller
        audit_id = sentinel.audit()

        record = sentinel.get_audit(audit_id)
        assert record["outcome"] == "unreachable"
        assert sentinel.get_covenant_info()["consecutive_failures"] == "0"


def test_audit_fails_closed_when_confidence_below_threshold():
    """A violation verdict below CONFIDENCE_THRESHOLD must not advance the
    failure streak -- inconclusive, fully retriable, no consequence."""
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        _mock_endpoint(vm, '{"status": "degraded"}')
        _mock_verdict(vm, False, "0.3", "Possibly failing, not sure.")
        vm.sender = seller
        audit_id = sentinel.audit()

        # Regression test: an earlier version of this contract left
        # record["outcome"] as the model's raw "violation" claim even though
        # confidence was below threshold and nothing counted -- silently
        # misrepresenting audit history to anyone reading get_audits() or
        # the frontend. The stored outcome must say "inconclusive" here, not
        # "violation", even though the model's own compliant/confidence
        # values are preserved for transparency.
        record = sentinel.get_audit(audit_id)
        assert record["outcome"] == "inconclusive"
        assert record["compliant"] is False
        assert record["confidence"] == "0.3"
        assert sentinel.get_covenant_info()["consecutive_failures"] == "0"


def test_audit_records_inconclusive_for_low_confidence_compliant_verdict_too():
    """Same fix, other direction: a low-confidence COMPLIANT claim must also
    be stored as inconclusive, not as a compliant record implying the streak
    was genuinely reset with confidence."""
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        _mock_endpoint(vm, '{"status": "ok"}')
        _mock_verdict(vm, True, "0.4", "Looks fine, but hard to tell.")
        vm.sender = seller
        audit_id = sentinel.audit()

        record = sentinel.get_audit(audit_id)
        assert record["outcome"] == "inconclusive"
        assert record["compliant"] is True


def test_three_consecutive_violations_trigger_a_breach_and_slash():
    vm = VMContext()
    seller, buyer = create_test_addresses(2)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        vm.sender = buyer
        sentinel.register_as_beneficiary()

        for i in range(3):
            vm.clear_mocks()
            _mock_endpoint(vm, '{"status": "error"}')
            _mock_verdict(vm, False, "0.9", f"Violation {i}.")
            warp_now(vm, f"2026-01-01T00:{i * 10:02d}:00Z")
            vm.sender = seller
            vm.value = 0
            audit_id = sentinel.audit()
            record = sentinel.get_audit(audit_id)

        assert record["breach_id"] == "0"
        info = sentinel.get_covenant_info()
        assert info["consecutive_failures"] == "0"  # reset after the breach
        assert info["total_breaches"] == "1"
        assert info["bond"] == "2000"  # 3000 - 1000 slashed

        breach = sentinel.get_breach("0")
        assert breach["slash_amount"] == "1000"
        assert breach["eligible_count"] == 1
        assert to_hex(buyer).lower() in [a.lower() for a in breach["eligible"]]


def test_breach_skips_beneficiaries_who_registered_after_the_triggering_audit():
    """A buyer cannot register the moment after seeing a breach coming and
    still collect -- eligibility is snapshotted against the breach's own
    triggering audit timestamp, not "registered at claim time"."""
    vm = VMContext()
    seller, latecomer = create_test_addresses(2)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)

        for i in range(3):
            vm.clear_mocks()
            _mock_endpoint(vm, '{"status": "error"}')
            _mock_verdict(vm, False, "0.9")
            warp_now(vm, f"2026-01-01T00:{i * 10:02d}:00Z")
            vm.sender = seller
            vm.value = 0
            sentinel.audit()

        # Registers only now, strictly after the breach already happened.
        vm.sender = latecomer
        sentinel.register_as_beneficiary()

        breach = sentinel.get_breach("0")
        assert breach["eligible_count"] == 0
        assert breach["slash_amount"] == "0"  # nothing slashed -- no one had standing


def test_breach_with_no_eligible_beneficiaries_does_not_slash_bond():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        for i in range(3):
            vm.clear_mocks()
            _mock_endpoint(vm, '{"status": "error"}')
            _mock_verdict(vm, False, "0.9")
            warp_now(vm, f"2026-01-01T00:{i * 10:02d}:00Z")
            vm.sender = seller
            vm.value = 0
            sentinel.audit()

        info = sentinel.get_covenant_info()
        assert info["bond"] == "3000"  # untouched -- no beneficiary to receive it
        assert info["total_breaches"] == "1"  # still logged for reputation


def test_sustained_unreachability_escalates_to_a_violation():
    vm = VMContext()
    seller, buyer = create_test_addresses(2)
    with vm.activate():
        sentinel = _deploy_active(vm, seller, slash_amount=1000, min_bond=3000)
        vm.sender = buyer
        sentinel.register_as_beneficiary()

        # Three unreachable audits, each MIN_AUDIT_INTERVAL_SECONDS (5 min)
        # apart, spanning well past UNREACHABLE_ESCALATION_SECONDS (1h).
        times = ["2026-01-01T00:00:00Z", "2026-01-01T00:06:00Z", "2026-01-01T01:12:00Z"]
        for t in times:
            warp_now(vm, t)
            vm.sender = seller
            vm.value = 0
            audit_id = sentinel.audit()

        # A single escalated-unreachable event counts as exactly ONE
        # violation toward FAILURE_THRESHOLD, same as any other confirmed
        # violation -- it does not instantly breach on its own.
        record = sentinel.get_audit(audit_id)
        assert record["outcome"] == "unreachable_escalated"
        assert record["breach_id"] == ""
        info = sentinel.get_covenant_info()
        assert info["total_violations"] == "1"
        assert info["total_breaches"] == "0"


def test_unreachable_streak_resets_on_a_reachable_audit():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        warp_now(vm, "2026-01-01T00:00:00Z")
        vm.sender = seller
        vm.value = 0
        sentinel.audit()  # unreachable, streak = 1

        vm.clear_mocks()
        _mock_endpoint(vm, '{"status": "ok"}')
        _mock_verdict(vm, True, "0.9")
        warp_now(vm, "2026-01-01T00:06:00Z")
        vm.sender = seller
        vm.value = 0
        sentinel.audit()  # compliant, resets streak

        warp_now(vm, "2026-01-01T02:00:00Z")
        vm.clear_mocks()
        vm.sender = seller
        vm.value = 0
        audit_id = sentinel.audit()  # unreachable again, streak = 1, not escalated
        assert sentinel.get_audit(audit_id)["outcome"] == "unreachable"


def test_audit_rate_limited():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        warp_now(vm, START)
        vm.sender = seller
        vm.value = 0
        sentinel.audit()
        with vm.expect_revert("rate-limited"):
            sentinel.audit()


def test_audit_rejects_when_not_active():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        vm.sender = seller
        sentinel = deploy_contract(
            SENTINEL_PATH, vm, "Service", ENDPOINT, SPEC, 1000, 3000
        )
        # Still pending_bond -- never funded.
        vm.sender = seller
        with vm.expect_revert("not active"):
            sentinel.audit()


def test_validator_independently_re_derives_and_agrees():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        _mock_endpoint(vm, '{"status": "ok"}')
        _mock_verdict(vm, True, "0.9")
        vm.sender = seller
        sentinel.audit()

        assert vm.run_validator() is True


def test_validator_disagrees_on_different_compliance_verdict():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        sentinel = _deploy_active(vm, seller)
        _mock_endpoint(vm, '{"status": "ok"}')
        _mock_verdict(vm, True, "0.9")
        vm.sender = seller
        sentinel.audit()

        disagrees = vm.run_validator(
            leader_result={
                "outcome": "violation",
                "compliant": False,
                "confidence": "0.9",
                "reasoning": "Different.",
                "evidence_snapshot": "x",
            }
        )
        assert disagrees is False
