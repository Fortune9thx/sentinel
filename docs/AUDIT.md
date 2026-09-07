# Audit: pre-hardened against known GenLayer portal rejection patterns

This document records a self-adversarial review of Sentinel, calibrated against real GenLayer
review team rejection language from this account's prior, unrelated submissions — not a generic
best-practices checklist. Unlike those prior projects, Sentinel was designed against every pattern
below from the first draft, so this is a design-time audit rather than a post-hoc fix log. Every
claim below is checked against the actual code and the regression test that proves it.

## 1. Validator independence

**Pattern:** *"The validator checks only verdict shape, ranges, and a few field combinations; it
does not independently review the evidence or verify the fulfillment decision."*

**How Sentinel avoids it:** `Sentinel.audit()`'s `validator_fn` calls `leader_fn()` again — a
fresh fetch of the live endpoint, a fresh LLM call — and compares the independently-derived
`outcome`/`compliant`/`confidence` against the leader's claim. Never a shape or range check of the
leader's own output. Covered by `test_validator_independently_re_derives_and_agrees` and
`test_validator_disagrees_on_different_compliance_verdict`.

## 2. Fail-closed on missing/unreliable evidence

**Pattern:** every fund-moving decision must fail closed on unfetchable or low-confidence
evidence, never proceed on a guess.

**How Sentinel avoids it:** an unfetchable endpoint returns a deterministic `unreachable` outcome
before the LLM is ever called, and does not count as a violation on its own. A compliant/violation
verdict below `CONFIDENCE_THRESHOLD` is recorded as inconclusive with no streak movement. Covered
by `test_audit_fails_closed_when_endpoint_unreachable` and
`test_audit_fails_closed_when_confidence_below_threshold`.

## 3. Evidence bound to reality

**Pattern:** *"bind each decision to the actual evidence content"* — never trust a model's
self-report of what it observed.

**How Sentinel avoids it:** `evidence_snapshot` is sliced from the real fetched response inside
contract code; the model is never asked to report what it saw. There is no field in the prompt
schema for the model to self-report evidence at all.

## 4. Bounded escape hatch for staked/bonded value

**Pattern:** *"a proposal's stake can remain locked forever if evaluation never reaches validator
agreement... add a bounded cancellation or expiry path."*

**How Sentinel avoids it:** the seller's bond is the only value staked in this design (buyers
register standing for free, risking nothing), and `request_exit()` → 72h cooldown →
`withdraw_remaining_bond()` gives it an explicit, bounded, permissionless recovery path
independent of whether any future audit ever runs again. Because `audit()` requires no locked
value to attempt (it's free and infinitely retriable, unlike a one-shot resolution gating a
specific pot of staked capital), the "resolution never converges" failure mode this pattern
targets does not have a direct analog here — but the bond-exit path was still built as a first-class
requirement, not an afterthought. Covered by `test_withdraw_after_cooldown_recovers_bond` and
`test_withdraw_before_cooldown_rejected`.

## 5. No single favorable result treated as a global, permanent conclusion

**Pattern:** *"a DISTINCT result against one challenger-selected baseline does not immediately make
the report immune to challenges against other confirmed baselines."*

**How Sentinel avoids it:** this pattern applies to designs with a duplicate/comparison-challenge
mechanic; Sentinel has no such mechanic (a covenant's breach history and beneficiary eligibility
are both independent, timestamp-anchored facts, never comparisons against a chosen prior
candidate). Explicitly checked and found not applicable to this design, rather than assumed.

## 6. Finality gating on anything acted on downstream

**Pattern:** *"wait for the deployment to reach FINALIZED status... before showing completion."*

**How Sentinel avoids it:** `create_covenant` (whose output — a new contract address — the
Explorer lists and a beneficiary immediately registers standing against) requires
`{ requireFinalized: true }` in the frontend. Every other write (`fund_bond`,
`register_as_beneficiary`, `audit`, `claim_slash_share`) surfaces success at `ACCEPTED`, since a
later reversal there just means the record disappears — nothing downstream has yet acted on it.

## 7. Execution-result checked explicitly, not inferred from consensus status

**Pattern:** a transaction reaching `ACCEPTED` consensus is not the same claim as its execution
having succeeded — a `gl.vm.UserError` revert still reaches `ACCEPTED` with
`txExecutionResultName: "FINISHED_WITH_ERROR"` on this chain.

**How Sentinel avoids it:** `lib/genlayer-client.ts`'s `describeTransactionOutcome()` requires the
explicit allowlisted value `ExecutionResult.FINISHED_WITH_RETURN`. `FINISHED_WITH_ERROR`,
`NOT_VOTED`, and a missing `txExecutionResultName` are all treated as unconfirmed, never defaulted
to success. Covered by a dedicated vitest suite (`lib/genlayer-client.test.ts`, 7 tests) ported
directly from this same finding on a prior project on this stack.

## 8. Idempotency / double-spend

**Pattern:** a payout path must not be claimable twice, and must not let one claimant drain a pool
that belongs to a different claim.

**How Sentinel avoids it:** `claimed["{breach_id}:{address}"]` is checked and set before the value
transfer (checks-effects-interactions). Each breach has its own isolated `breach_pool`/
`breach_eligible` entry — a claim against one breach can never draw down a different breach's pool.
Covered by `test_double_claim_rejected` and `test_non_eligible_caller_cannot_claim`.

## 9. Mechanical GenVM/frontend-wiring bugs

**Checked and confirmed correct:**
- `genvm-lint check` passes clean on both contracts (one nondet call per method, no lambda
  leaders), enforced in CI on every push.
- Read client is a memoized, no-account singleton (`getReadOnlyClient()`); write client binds
  `connector.getProvider()`, never `window.ethereum` directly.
- Every address-keyed `TreeMap` lookup normalizes via `_normalize_address()` on both write and
  read sides.
- All numeric/decimal values (confidence, wei amounts) are stringified before crossing any
  calldata boundary — GenVM calldata has no float type.
- Storage uses only `TreeMap[str, str]` and `DynArray[str]`, matching the confirmed-safe pattern
  on the current Bradbury GenVM build.
- Every read that a write decision depends on (creation stake, bond values) uses
  `readContractRetry` — bounded retry plus a hard per-attempt timeout, not retry-on-rejection
  alone, since Bradbury's `gen_call` path has real, confirmed intermittent failures independent of
  contract correctness.

## 10. Test coverage matches every claim made above

41/41 direct-mode `gltest` tests passing, `genvm-lint` clean on both contracts, 7/7 frontend unit
tests, clean production build. A real Bradbury integration test file
(`tests/integration/test_full_lifecycle.py`) exercises the full `create_covenant → fund_bond →
audit` path against a real live endpoint, not just the WASI mock.

## Acknowledged, not fully closeable

Judging whether a live response satisfies a natural-language spec is fundamentally a qualitative
LLM judgment, not a deterministic computation. Every mechanism in this contract (fail-closed
evidence, sustained-streak requirement, independent validator re-derivation) hardens the process
around that judgment; none of them turn it into something fully mechanical. Stated explicitly
here, consistent with the same standard applied to every prior project on this account.
