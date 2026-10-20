"""
Direct-mode tests for Continuous Audit Signals on SentinelSignals.

The critical invariant under test: every successful poll pays exactly once,
inside that same poll, and the separate claim_signal entry point can never
pay anything. A signal's pool is isolated from the covenant's bond/breach
pool, and a HIT never slashes or triggers a breach on its own.
"""

import json

from gltest.direct import VMContext, create_test_addresses

from conftest import (
    SENTINEL_SIGNALS_FACTORY_PATH,
    SENTINEL_SIGNALS_PATH,
    deploy_contract,
    to_hex,
    warp_now,
)

SPEC = "99.9% uptime, JSON responses only, no error codes in the body."
ENDPOINT = "https://example.com/status"
SIGNAL_ENDPOINT = "https://example.com/signals"
RULE = "The response body reports a degraded or failing state."
START = "2026-01-01T00:00:00Z"
POLL_AT = "2026-01-01T00:01:01Z"
POLL_2 = "2026-01-01T00:02:02Z"
EXPIRES = "2026-02-01T00:00:00Z"


def _epoch(iso: str) -> int:
    from datetime import datetime

    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def _web(body: str, status: int = 200) -> dict:
    return {"method": "GET", "status": status, "body": body}


def _wrapped_json(payload: dict) -> str:
    return f"Here is my analysis.\n```json\n{json.dumps(payload)}\n```\nEnd of response."


def _mock_endpoint(vm, body='{"status": "degraded"}', status=200):
    vm.mock_web(r"example\.com/signals", _web(body, status))


def _mock_verdict(vm, hit=True, confidence="0.9", reasoning="Observed live."):
    vm.mock_llm(
        r"independent signal watcher",
        _wrapped_json({"hit": hit, "confidence": confidence, "reasoning": reasoning}),
    )


def _deploy_active(vm, seller, slash_amount=1000, min_bond=3000):
    vm.sender = seller
    contract = deploy_contract(
        SENTINEL_SIGNALS_PATH, vm, "API Status Service", ENDPOINT, SPEC, slash_amount, min_bond
    )
    warp_now(vm, START)
    vm.value = min_bond
    contract.fund_bond()
    vm.value = 0
    return contract


def _create_signal(vm, contract, creator, pool=1000, reward=100, stipend=10):
    vm.sender = creator
    vm.value = pool
    signal_id = contract.create_audit_signal(
        "Degraded state",
        SIGNAL_ENDPOINT,
        RULE,
        60,
        reward,
        stipend,
        _epoch(EXPIRES),
    )
    vm.value = 0
    return signal_id


def test_poll_audit_signal_pays_exactly_once_per_poll_and_claim_cannot_double_pay():
    vm = VMContext()
    seller, poller = create_test_addresses(2)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        signal_id = _create_signal(vm, contract, seller, pool=1000, reward=100, stipend=10)
        _mock_endpoint(vm)
        _mock_verdict(vm, hit=True, confidence="0.9")

        warp_now(vm, POLL_AT)
        vm.sender = poller
        vm.value = 0
        first_poll = contract.poll_audit_signal(signal_id)

        signal = contract.get_signal(signal_id)
        assert signal["poll_count"] == "1"
        assert signal["payout_count"] == "1"
        assert signal["total_paid"] == "100"
        assert signal["pool_remaining"] == "900"
        assert signal["hit_count"] == "1"

        polls = contract.get_signal_polls(signal_id)
        assert len(polls) == 1
        assert polls[0]["id"] == first_poll
        assert polls[0]["payout"] == "100"

        # The only payout path is the poll itself. claim_signal exists to
        # make that explicit and must always revert without moving value.
        with vm.expect_revert("only inside poll_audit_signal"):
            contract.claim_signal(signal_id)
        assert contract.get_signal(signal_id)["pool_remaining"] == "900"

        # An immediate second poll is cooldown-blocked, not a second payout.
        with vm.expect_revert("rate-limited"):
            contract.poll_audit_signal(signal_id)
        assert contract.get_signal(signal_id)["payout_count"] == "1"

        # After the interval, exactly one more poll == exactly one more payout.
        warp_now(vm, POLL_2)
        vm.sender = poller
        vm.value = 0
        contract.poll_audit_signal(signal_id)
        signal = contract.get_signal(signal_id)
        assert signal["poll_count"] == "2"
        assert signal["payout_count"] == "2"
        assert signal["total_paid"] == "200"
        assert signal["pool_remaining"] == "800"
        assert len(contract.get_signal_polls(signal_id)) == 2


def test_signal_hit_never_slashes_bond_or_triggers_breach():
    vm = VMContext()
    seller, poller = create_test_addresses(2)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        signal_id = _create_signal(vm, contract, seller)
        _mock_endpoint(vm)
        _mock_verdict(vm, hit=True, confidence="0.95")

        warp_now(vm, POLL_AT)
        vm.sender = poller
        vm.value = 0
        contract.poll_audit_signal(signal_id)

        info = contract.get_covenant_info()
        assert info["bond"] == "3000"
        assert info["total_breaches"] == "0"
        assert info["consecutive_failures"] == "0"
        assert contract.get_signal(signal_id)["consecutive_hits"] == "1"


def test_unjudgeable_http_status_is_inconclusive_and_pays_only_stipend():
    vm = VMContext()
    seller, poller = create_test_addresses(2)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        signal_id = _create_signal(vm, contract, seller, pool=1000, reward=100, stipend=10)
        _mock_endpoint(vm, body="down", status=503)

        warp_now(vm, POLL_AT)
        vm.sender = poller
        vm.value = 0
        contract.poll_audit_signal(signal_id)

        signal = contract.get_signal(signal_id)
        assert signal["last_outcome"] == "inconclusive"
        assert signal["inconclusive_count"] == "1"
        assert signal["hit_count"] == "0"
        assert signal["total_paid"] == "10"
        assert signal["pool_remaining"] == "990"


def test_low_confidence_hit_is_inconclusive_not_a_hit():
    vm = VMContext()
    seller, poller = create_test_addresses(2)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        signal_id = _create_signal(vm, contract, seller)
        _mock_endpoint(vm)
        _mock_verdict(vm, hit=True, confidence="0.2")

        warp_now(vm, POLL_AT)
        vm.sender = poller
        vm.value = 0
        contract.poll_audit_signal(signal_id)

        signal = contract.get_signal(signal_id)
        assert signal["last_outcome"] == "inconclusive"
        assert signal["hit_count"] == "0"
        assert signal["consecutive_hits"] == "0"


def test_non_creator_cannot_pause_cancel_or_top_up_and_cancel_refunds_pull_only():
    vm = VMContext()
    seller, stranger = create_test_addresses(2)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        signal_id = _create_signal(vm, contract, seller, pool=1000)

        vm.sender = stranger
        with vm.expect_revert("Only the signal creator"):
            contract.pause_signal(signal_id)
        with vm.expect_revert("Only the signal creator"):
            contract.cancel_signal(signal_id)
        vm.value = 500
        with vm.expect_revert("Only the signal creator"):
            contract.top_up_signal(signal_id)
        vm.value = 0

        vm.sender = seller
        contract.cancel_signal(signal_id)
        signal = contract.get_signal(signal_id)
        assert signal["status"] == "cancelled"
        assert signal["pool_remaining"] == "0"
        assert signal["creator_refundable"] == "1000"

        # Refunds are pull-only: cancel moved value to a refund ledger, it did
        # not push anything during the cancel transaction.
        assert contract.get_signal_refund(to_hex(seller)) == "1000"
        contract.claim_refund()
        assert contract.get_signal_refund(to_hex(seller)) == "0"
        with vm.expect_revert("No signal refund"):
            contract.claim_refund()


def test_expired_signal_refunds_and_cannot_be_polled():
    vm = VMContext()
    seller, poller = create_test_addresses(2)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        signal_id = _create_signal(vm, contract, seller, pool=1000)

        warp_now(vm, "2026-02-01T00:00:01Z")
        vm.sender = poller
        vm.value = 0
        with vm.expect_revert("expired"):
            contract.poll_audit_signal(signal_id)

        contract.expire_signal(signal_id)
        signal = contract.get_signal(signal_id)
        assert signal["status"] == "expired"
        assert signal["pool_remaining"] == "0"
        assert contract.get_signal_refund(to_hex(seller)) == "1000"


def test_top_up_reactivates_an_exhausted_pool_and_extends_runway():
    vm = VMContext()
    seller, poller = create_test_addresses(2)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        signal_id = _create_signal(vm, contract, seller, pool=100, reward=100, stipend=10)
        _mock_endpoint(vm)
        _mock_verdict(vm, hit=True, confidence="0.9")

        warp_now(vm, POLL_AT)
        vm.sender = poller
        vm.value = 0
        contract.poll_audit_signal(signal_id)
        signal = contract.get_signal(signal_id)
        assert signal["status"] == "exhausted"
        assert signal["pool_remaining"] == "0"

        vm.sender = seller
        vm.value = 250
        contract.top_up_signal(signal_id)
        vm.value = 0
        signal = contract.get_signal(signal_id)
        assert signal["status"] == "active"
        assert signal["pool_remaining"] == "250"


def test_create_signal_validates_rule_url_interval_and_pool():
    vm = VMContext()
    seller, = create_test_addresses(1)
    with vm.activate():
        contract = _deploy_active(vm, seller)
        vm.sender = seller
        vm.value = 100

        with vm.expect_revert("label is required"):
            contract.create_audit_signal("", SIGNAL_ENDPOINT, RULE, 60, 100, 10, _epoch(EXPIRES))
        with vm.expect_revert("localhost/private/internal"):
            contract.create_audit_signal(
                "Bad", "http://127.0.0.1/signals", RULE, 60, 100, 10, _epoch(EXPIRES)
            )
        with vm.expect_revert("rule is required"):
            contract.create_audit_signal("Bad", SIGNAL_ENDPOINT, "", 60, 100, 10, _epoch(EXPIRES))
        with vm.expect_revert("interval_seconds"):
            contract.create_audit_signal("Bad", SIGNAL_ENDPOINT, RULE, 5, 100, 10, _epoch(EXPIRES))
        with vm.expect_revert("stipend"):
            contract.create_audit_signal("Bad", SIGNAL_ENDPOINT, RULE, 60, 100, 200, _epoch(EXPIRES))
        with vm.expect_revert("Initial pool"):
            contract.create_audit_signal("Bad", SIGNAL_ENDPOINT, RULE, 60, 150, 10, _epoch(EXPIRES))


def test_signals_factory_deploys_with_signals_source():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        vm.sender = owner
        source = SENTINEL_SIGNALS_PATH.read_text(encoding="utf-8")
        factory = deploy_contract(SENTINEL_SIGNALS_FACTORY_PATH, vm, source, 0)
        assert factory.get_covenants_count() == 0
        assert factory.get_creation_stake() == "0"


def test_signals_factory_requires_source():
    vm = VMContext()
    with vm.activate():
        with vm.expect_revert("Missing SentinelSignals contract source"):
            deploy_contract(SENTINEL_SIGNALS_FACTORY_PATH, vm, "", 0)
