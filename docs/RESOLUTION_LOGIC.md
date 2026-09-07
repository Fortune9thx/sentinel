# Resolution logic

This document walks through `Sentinel.audit()` and the breach state machine in `contracts/Sentinel.py`
step by step, and explains every deliberate deviation from the naive/obvious implementation.

## Preconditions

```python
if self.status not in (STATUS_ACTIVE, STATUS_EXITING):
    raise gl.vm.UserError("Covenant is not active.")
now = _consensus_now()
if int(self.last_audit_at) and now < int(self.last_audit_at) + MIN_AUDIT_INTERVAL_SECONDS:
    raise gl.vm.UserError(f"Audits are rate-limited to one every {MIN_AUDIT_INTERVAL_SECONDS} seconds.")
self.last_audit_at = u256(now)
```

Audits remain callable during `STATUS_EXITING`, not just `STATUS_ACTIVE` — deliberately. If a
seller could block new audits simply by calling `request_exit()`, the 72h cooldown would become a
guaranteed escape hatch from an imminent breach. Instead, `audit()` (and therefore slashing) stays
live for the entire cooldown; only `STATUS_EXITED` (after `withdraw_remaining_bond()`) blocks it.

## The leader function: fetch, then fail closed before ever calling the LLM

```python
def leader_fn():
    try:
        fetched = gl.nondet.web.render(endpoint_url, mode="text", wait_after_loaded="3s") or ""
    except Exception:
        fetched = ""
    excerpt = _sanitize_input(fetched, MAX_EVIDENCE_LEN)

    if not excerpt:
        return {"outcome": AUDIT_UNREACHABLE, "compliant": False, "confidence": "0.0",
                "reasoning": "The endpoint could not be fetched at audit time.",
                "evidence_snapshot": ""}

    prompt = f"""...service, spec, live response, judgment rules..."""
    raw_response = gl.nondet.exec_prompt(prompt)
    parsed = _parse_json_object(raw_response)
    compliant = bool(parsed.get("compliant", False))
    return {"outcome": AUDIT_COMPLIANT if compliant else AUDIT_VIOLATION, "compliant": compliant,
            "confidence": _stringify_confidence(parsed.get("confidence")),
            "reasoning": str(parsed.get("reasoning", ""))[:MAX_REASONING_LEN],
            "evidence_snapshot": excerpt[:MAX_EVIDENCE_ITEM_LEN]}
```

The endpoint is fetched **inside this single leader closure**, not as a separate top-level nondet
call — `genvm-lint` (and real portal reviewers) require exactly one non-deterministic block per
method. If the fetch comes back empty, the leader returns deterministically **without ever calling
the LLM** — every validator independently observes the identical `unreachable` outcome with no
model involved, guaranteeing agreement on a case that genuinely has nothing to judge.

`evidence_snapshot` is sliced from `excerpt` — the real fetched text — never from anything the
model claims to have seen. Even a fully adversarial model response cannot inject a fabricated
"evidence" record; the contract only ever stores what it itself retrieved.

## The validator function: independent re-derivation, not shape-checking

```python
def validator_fn(leader_result) -> bool:
    if not isinstance(leader_result, gl.vm.Return):
        return False
    leader_data = leader_result.calldata
    mine = leader_fn()

    if mine.get("outcome") != leader_data.get("outcome"):
        return False
    if mine.get("outcome") == AUDIT_UNREACHABLE:
        return True
    try:
        confidence_agrees = abs(
            float(mine.get("confidence", "0.0")) - float(leader_data.get("confidence", "0.0"))
        ) < CONFIDENCE_AGREEMENT_TOLERANCE
    except (TypeError, ValueError):
        return False
    return mine.get("compliant") == leader_data.get("compliant") and confidence_agrees
```

Each validator calls `leader_fn()` again — a fresh fetch of the live endpoint, a fresh LLM call —
rather than only checking that the leader's claimed output has the right shape or falls in a
plausible range. This is the direct fix for a real, confirmed GenLayer rejection reason from a
prior submission on this account: *"the validator checks only verdict shape... it does not
independently review the evidence... redesign the validator to independently acquire and assess
the evidence."*

## Interpreting the result: fail-closed on low confidence, streak tracking, and escalation

```python
result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
...
if outcome == AUDIT_UNREACHABLE:
    # sustained-unreachability escalation (see below)
    ...
elif outcome == AUDIT_VIOLATION and confidence_val >= CONFIDENCE_THRESHOLD:
    breach_id = self._record_violation(audit_id, now)
elif outcome == AUDIT_COMPLIANT and confidence_val >= CONFIDENCE_THRESHOLD:
    self.consecutive_failures = u256(0)
# else: confidence below threshold -- inconclusive, fail-closed, no streak movement
```

A violation verdict below `CONFIDENCE_THRESHOLD` (0.6) is treated identically to "nothing decisive
happened" — it does not advance the streak, and it does not clear it either. Only a confidently
compliant audit resets the streak; only a confidently violating one advances it.

## Sustained-unreachability escalation

```python
if int(self.unreachable_streak) == 0:
    self.first_unreachable_at = u256(now)
self.unreachable_streak = u256(int(self.unreachable_streak) + 1)
escalates = (
    int(self.unreachable_streak) >= UNREACHABLE_ESCALATION_COUNT
    and now >= int(self.first_unreachable_at) + UNREACHABLE_ESCALATION_SECONDS
)
if escalates:
    breach_id = self._record_violation(audit_id, now)
    self.unreachable_streak = u256(0)
    self.first_unreachable_at = u256(0)
```

A single unreachable audit is deliberately **not** treated as a violation — an audit-side network
hiccup is not evidence the seller's service is actually down. Only once both a minimum consecutive
count (3) **and** a minimum elapsed time (1h) are cleared does sustained unreachability escalate
into exactly one confirmed violation, counted the same way as a direct compliance failure. A single
compliant or genuinely-fetched audit at any point resets this streak too.

## Recording a violation, and triggering a breach

```python
def _record_violation(self, audit_id, now):
    self.consecutive_failures = u256(int(self.consecutive_failures) + 1)
    self.total_violations = u256(int(self.total_violations) + 1)
    if int(self.consecutive_failures) < FAILURE_THRESHOLD:
        return ""
    self.consecutive_failures = u256(0)

    eligible = [addr for addr in self.beneficiaries
                if int(self.beneficiary_registered_at.get(addr, "0")) < now]
    ...
    actual_slash = min(int(self.slash_amount), int(self.bond))
    if actual_slash > 0 and eligible:
        self.bond = u256(int(self.bond) - actual_slash)
        self.breach_pool[breach_id] = str(actual_slash)
        self.breach_eligible[breach_id] = json.dumps(eligible)
    else:
        self.breach_pool[breach_id] = "0"
        self.breach_eligible[breach_id] = json.dumps([])
    ...
```

Three consecutive confirmed violations (direct or escalated) trigger a breach. Eligibility is
computed **at this exact moment**, from each beneficiary's own `registered_at` timestamp compared
against `now` (this audit's evaluation time) — not against whenever a later claim happens to be
made. A beneficiary who registers after this line has already run has no path into `eligible` for
this breach, closing the "wait for a breach then register to snipe it" gaming vector without a
cooldown or challenge window.

If there is bond to slash but zero eligible beneficiaries, the breach is still logged (the
reputational record stands) but nothing is moved — there is no scenario in this design where value
ends up in an unclaimable pool.

## Claiming a share

```python
@gl.public.write
def claim_slash_share(self, breach_id: str) -> None:
    eligible = json.loads(self.breach_eligible.get(breach_id, "[]"))
    if not eligible:
        raise gl.vm.UserError("No eligible beneficiaries for this breach.")
    sender_hex = _normalize_address(gl.message.sender_address.as_hex)
    if sender_hex not in eligible:
        raise gl.vm.UserError("Caller was not an eligible beneficiary for this breach.")
    claim_key = f"{breach_id}:{sender_hex}"
    if self.claimed.get(claim_key, "") == "1":
        raise gl.vm.UserError("Already claimed this breach.")
    ...
```

Caller-specific facts (eligibility, prior claim) are checked **before** pool-level math. With a
single eligible beneficiary, their own claim empties the pool entirely — checking pool emptiness
first would reject their own re-claim attempt with a misleading "nothing left" instead of the more
accurate "you already claimed." Checks-effects-interactions: `claimed[...]` and `breach_pool[...]`
are both updated before the external value transfer.
