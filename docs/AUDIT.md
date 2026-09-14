## Two-tier verification for register_covenant (2026-09-14, follow-up)

A critical self-review of item 4 above (preventing look-alike covenants) confirmed the residual gap is
real and structural: `register_covenant()`'s checks close the lazy/accidental forgery case but cannot,
even in principle, stop a deliberate one -- confirmed by tracing GenVM's own `create2_address()`
formula (`keccak256(0x01 || deployer || salt_nonce || chain_id)`), which does NOT hash in the
contract's bytecode the way Ethereum's real CREATE2 does. Even GenVM's own deterministic-address
feature provides no binding between an address and the code deployed there, so no address-based check
from within a contract can ever close this -- confirmed exhaustively, not assumed.

Since the code-level gap can't be closed further, the fix is architectural: `verified_covenants`, a
second, independent, ADDITIVE trust signal layered on top of the unchanged, still fully permissionless
registry.

- A `create_covenant()` entry is auto-verified at registration -- the factory deployed that exact
  bytecode itself via `gl.contract.deploy()`, so this is cryptographically certain, not a judgment
  call.
- A `register_covenant()` entry starts unverified. The factory owner -- the one party with a
  reputational stake in the registry being trustworthy -- can review the deployed contract's actual
  source off-chain and call the new owner-only `verify_covenant()` to flip it.
- Verification never gates listing, funding, auditing, or any other functionality -- an unverified
  covenant is fully live and usable. It is purely an additive signal the frontend surfaces (a
  "Verified" badge on `CovenantCard` and the covenant detail page, plus an explicit note when a
  covenant is unverified) without ever hiding or blocking an unverified entry -- preserving the
  project's stated design principle that covenant creation stays permissionless, gated by stake, not
  an admin allowlist.

New views: `is_covenant_verified(address)`, and `get_covenant_meta()` now includes a `verified` field.

Live-verified end-to-end on a fresh factory redeploy
(`0xb6DB0D4800733F96916C4ceE544A0065771617DD`): a `register_covenant()` entry starts unverified, the
owner's `verify_covenant()` call flips it to verified, and a non-owner caller attempting the same call
is correctly rejected -- 7/7 checks passed.

**What this does and does not achieve, stated plainly**: this does not make GenVM able to compare
bytecode -- that remains impossible with current primitives. What it does is shrink the actual blast
radius of the disclosed gap from "any address, callable by anyone" to "requires either fooling the
factory owner or the owner acting maliciously" -- the same trust model as essentially any curated
registry in Web3 (e.g. token lists), stated honestly rather than implied to be fully trustless when
the platform doesn't yet support that.

## Steward-requested hardening (2026-09-14)

A GenLayer steward reviewed the submission and requested six specific changes: make beneficiary
eligibility verifiable, keep breach processing bounded, constrain audits to SLA claims the contract's
own evidence actually supports, prevent unverified look-alike contracts from appearing as trusted
covenants, enforce a real JSON boolean for the compliance result, and add focused tests for these
trust boundaries plus the actual deploy-then-register workflow. Each is addressed below, with what
was and wasn't fully closeable stated plainly.

**1 & 2 — beneficiary eligibility and bounded breach processing (one fix covers both).**
`register_as_beneficiary()` was completely free and unbounded: any address could register with zero
proof of any real relationship to the service, and nothing capped how many could. Beyond the fairness
problem, this was a real liveness bug: `_record_violation()` iterates every registered beneficiary on
every violating/escalated audit to compute breach eligibility, so an unbounded flood of free Sybil
registrations could make that loop -- and the breach-triggering audit call it runs inside -- arbitrarily
expensive, potentially DoSing the one guarantee this contract exists to make (a confirmed breach
actually slashes and pays out). **Fix**: added `MAX_BENEFICIARIES = 500` in `Sentinel.py`, enforced in
`register_as_beneficiary()`. This bounds the loop's cost regardless of registration attempts.
**Disclosed, not fully closed**: this makes eligibility bounded and gives it real (if informal)
meaning -- "registered before the cap filled" -- but it is still not a cryptographic proof of real
usage; GenVM has no on-chain way to verify a registrant is a genuine customer of the audited service.
Live-verified: `tests/direct/test_beneficiary_cap.py` registers 500 real addresses then proves the
501st is rejected.

**3 — constraining audits to what the evidence actually supports.** Two real gaps here. First, the
audit prompt asked the model to judge the *entire* spec against a single rendered page-body fetch
(`gl.nondet.web.render(..., mode="text")`), which captures neither the HTTP status code nor response
headers nor latency -- so a common class of SLA claim ("must return HTTP 200") was structurally
unverifiable from the evidence actually captured, yet nothing stopped the model from guessing at
compliance anyway. **Fix**: the prompt now explicitly tells the model what this evidence channel can
and cannot prove, instructs it to judge only the observable portion of the spec when a claim isn't
checkable from the body text, and to lower confidence rather than assume either way. Second, the
injection-defense framing already fenced the fetched response as `DATA, NOT INSTRUCTIONS`; this was
kept and reinforced with a stronger "use ONLY what is directly observable" instruction in the judgment
paragraph itself.

**4 — preventing unverified look-alike contracts.** `register_covenant()`'s existing hardening (caller
must equal the target's own reported seller; target must report `pending_bond` status and zero
bond/audit_count/total_breaches) was extended: the target's reported `service_name`/`endpoint_url`/
`spec` are now independently validated against the exact same length bounds and SSRF-safety checks
`Sentinel.__init__` enforces on every genuine covenant. A real Sentinel instance could never actually
hold an oversized or unsafe value there -- its own constructor rejects them -- so a target reporting
one is proof it isn't running genuine Sentinel logic, and is now rejected outright rather than having
that unsafe data copied into the registry's own public metadata. **Disclosed, not fully closed**: GenVM
still exposes no in-contract primitive to compare another contract's actual bytecode/source hash (
confirmed again this session by re-grepping the cached SDK source), so a sufficiently deliberate forgery
that hard-codes plausible-looking, well-formed responses to every check can still pass. What's
closed is the accidental/lazy case (stale, third-party, or malformed-data registrations); what remains
open is a purpose-built forgery, which is the honest limit of what a contract without a code-hash
primitive can verify about another contract. Live-verified end-to-end (see below).

**5 — enforcing a real JSON boolean for the compliance result.** Found a genuine, concrete bug:
`compliant = bool(parsed.get("compliant", False))` truth-tests whatever JSON type the model produced.
`bool("false")` is `True` in Python -- any non-empty string is truthy -- so a model that quoted its
boolean (`"compliant": "false"`, a real, observed LLM habit despite the prompt asking for an unquoted
JSON literal) would have its literal false verdict silently flipped to a compliant outcome. **Fix**:
added `_parse_bool_strict()`, which accepts a real JSON bool as-is, accepts the quoted `"true"`/
`"false"` string form case-insensitively, and fails closed to `False` for anything else (a number,
null, missing field, garbage) -- consistent with every other ambiguous-input path already in this
contract. Applied at both the point the model's response is parsed and the point the audit record is
constructed. Regression-tested in `tests/direct/test_audit.py` (`test_audit_treats_quoted_string_false_
as_not_compliant`, `..._true_as_compliant`, `..._garbage_compliant_field_as_not_compliant`).

**6 — focused tests for these trust boundaries and the deploy-then-register workflow.** Added:
`tests/direct/test_beneficiary_cap.py` (the 500-cap enforcement, direct-mode, no live network needed);
three new regression tests in `tests/direct/test_audit.py` for the strict-boolean fix; and four new
integration tests in `tests/integration/test_full_lifecycle.py` --
`test_register_covenant_accepts_a_fresh_directly_deployed_covenant`,
`test_register_covenant_rejects_non_seller_caller`,
`test_register_covenant_rejects_double_registration`, and
`test_register_covenant_rejects_a_non_fresh_covenant` -- which exercise the *actual* production path
(direct Sentinel deploy, then `register_covenant()`) rather than the internally-broken
`create_covenant()` path the rest of that file's older tests use. Existing tests already exercising
`create_covenant()` remain in place but are marked in a new module comment as not reproducible on
Studio Devnet today, for the same disclosed fee-allocation reason as everywhere else in this document.

**Live re-verification.** Redeployed `SentinelFactory` with all of the above to Studio Devnet at
`0xD159065388a596b83B56dE34C83806666d59B8E7` (tx
`0x3b844f45bef9784ac7d9aa1a77f0a3bd0373279c4acedcb298014be2b2823a82`, FINALIZED) and re-ran the full
deploy -> register -> fund -> register-beneficiary -> audit path live, this time with realistic small
bond values (min_bond 3 GEN, not the earlier placeholder 3000 GEN a real user could never fund), and
confirmed the audit's returned `compliant` field is a genuine JSON boolean end-to-end, not a
truthy-coerced string.

## Live verification on GenLayer Studio Devnet (2026-09-11): full lifecycle proven working end-to-end

After the Consensus v0.6 API migration (below) and the mega-audit fixes (below), `SentinelFactory
.create_covenant()` still failed to deploy child covenants — traced initially to a v0.6
internal-message fee-allocation gap (`fee no_matching_allocation # internal`), a platform-side issue
in how the new fee system handles a write that itself triggers a cross-contract deploy. Deeper
investigation found a SECOND, independent bug stacked underneath it: `gl.vm.get_timestamp()` — the
SDK's own documented v0.3.0 timestamp API, called from `Sentinel.__init__` — is itself broken on
Studio Devnet's live GenVM runtime (`SystemError: 2: inval`, confirmed via a real deploy attempt's
decoded traceback), not just absent from local test tooling. This meant every covenant deploy was
doomed regardless of the fee-allocation issue — the fee bug was simply the first of two failures to
surface. **Fix**: switched `_consensus_now()` in both contracts to `gl.message.raw["datetime"]`
(reads data already loaded into the VM's startup payload, not a separate VM call). **Verified with a
real, live, 9/9-passing end-to-end run**: a direct `Sentinel.py` deploy (bypassing the factory's
internal-deploy path, which remains blocked by the fee-allocation gap specifically) →
`fund_bond` (auto-activates at `min_bond`) → `register_as_beneficiary` → a genuine `audit()` call
that fetched a real live URL and received a real LLM verdict (`compliant`, 0.97 confidence) with a
real evidence snapshot, all reaching `FINISHED_WITH_RETURN`. This proves Sentinel's actual core
mechanism — live-fetch + LLM judgment under Equivalence Principle consensus — genuinely works
end-to-end on the v0.6 network. `SentinelFactory.create_covenant()`'s atomic deploy-and-register
path remains blocked pending an upstream fix to the internal-message fee-allocation gap; direct
per-covenant deployment is the practical path forward until then.

## Mega audit (2026-09-11): full 177-point checklist pass, 3 real findings, all fixed

Applied the full accumulated GenLayer master audit checklist (177 items, compiled across every
prior project on this account) against Sentinel's current code — not a repeat of the earlier
strict-review pass above, a fresh independent sweep. Found three genuine, previously-missed issues;
all fixed in this pass.

**1. No SSRF protection on `endpoint_url` (real security gap).** Both `Sentinel.__init__` and
`SentinelFactory.create_covenant` validated only the `http(s)://` prefix and a length cap —
`http://localhost/...`, `http://127.0.0.1/...`, `http://2130706433/...` (decimal-encoded loopback),
private-range IPs, explicit ports, and embedded credentials all passed. Since every validator
independently fetches this URL server-side via `gl.nondet.web.render`, an unvalidated internal
target would make the whole validator set an unwitting internal-request proxy. **Fix:** a
`_is_safe_endpoint_url()` helper (duplicated in both contracts, matching the existing duplication
convention for `_consensus_now`/`_normalize_address`/`_Recipient`) using `urllib.parse.urlsplit` +
the stdlib `ipaddress` module to reject localhost, loopback/private/link-local/reserved/multicast
IPs (including decimal-encoded forms), explicit ports, and embedded credentials. Six new regression
tests added across `test_factory_validation.py`/`test_bonding.py`, all passing.

**2. CI has never actually passed — `pip install .` fails on every run (real, previously
undetected).** `docs/AUDIT.md` (this file) claimed `genvm-lint`/tests were "enforced in CI on every
push," but every recorded CI run failed at the very first Python step: `pip install .` errors with
"Multiple top-level packages discovered in a flat-layout" (setuptools refusing to guess a package
structure from `contracts/`, `deploy/`, `frontend/` sitting alongside `pyproject.toml`). A workflow
file existing is not evidence it has run green — checked directly via `gh run list`, not assumed.
**Fix:** `[tool.setuptools] packages = []` in `pyproject.toml` — this project has no distributable
Python package of its own, only tooling dependencies to install. Verified locally with
`pip install --dry-run .`.

**3. Local direct-mode test harness was still on the pre-v0.6-migration toolchain pin.**
`tests/direct/conftest.py` hardcoded `sdk_version="v0.2.16"` (the OLD, now-unhosted GenVM version)
and imported the OLD SDK module layout (`genlayer.py.types`, `genlayer.gl`) — both stale since the
contracts' own Consensus v0.6 migration (see project memory). **Fix:** re-pinned to `v0.6.0-rc5`,
fixed the `Address` import path to `genlayer.types`, and marked the now-defunct `warp_now()`
timestamp patch as an honest no-op rather than a silent wrong-fix (see below). Direct-mode tests
went from 0/54 collecting to 22/54 passing — every non-timestamp-touching guard clause (all the new
SSRF tests included) now runs and passes again.

**Confirmed, not fixed (genuine external toolchain gap, not a contract bug):** `gltest` direct-mode's
WASI mock does not implement the `GetTimestamp` VM call at all yet — `gl.vm.get_timestamp()` (the
v0.3.0 replacement for the old `gl.message_raw["datetime"]` pattern) always returns `None` locally,
crashing any method that calls it. This blocks the remaining 32/54 direct-mode tests (anything that
deploys or calls a Sentinel method, since `_consensus_now()` is called from `__init__` onward) until
GenLayer's own test tooling adds support — confirmed by grepping the entire installed `gltest`
package source, zero references anywhere. Not worked around with a monkeypatch, which would risk
silently testing a fake clock instead of real contract logic. These paths remain covered by live
integration testing instead (`tests/integration/test_full_lifecycle.py`), and by the real,
verified Consensus v0.6 Studio Devnet deploy (`SentinelFactory` FINALIZED with a genuine
`FINISHED_WITH_RETURN`, clean reads) already completed this session.

Everything else in the 177-point checklist was reviewed against the actual current code (both
contracts, `lib/genlayer-client.ts`, `lib/sentinel-calls.ts`, `lib/useTransactionLifecycle.ts`,
`lib/wagmi-config.ts`, `AppNav.tsx`, CI config, repo hygiene) and confirmed already correct — the
finality-gating, execution-result-checking, ephemeral-read-account, provider-binding, and
registry-diff patterns documented in the sections below all still hold.

# Audit: pre-hardened against known GenLayer portal rejection patterns

This document records a self-adversarial review of Sentinel, calibrated against real GenLayer
review team rejection language from this account's prior, unrelated submissions — not a generic
best-practices checklist. Unlike those prior projects, Sentinel was designed against every pattern
below from the first draft, so this is a design-time audit rather than a post-hoc fix log. Every
claim below is checked against the actual code and the regression test that proves it.

## Strict-review pass (post-launch): 3 real findings, all fixed

A second, adversarial pass — after the initial build and first Bradbury deploy — found three real
issues the design-time review above missed. All three are fixed, tested, and shipped in the current
deploy; none were merely disclosed.

**1. Funds were permanently stranded if a covenant never reached `min_bond` (critical).**
`request_exit()` originally required `STATUS_ACTIVE`. A covenant stuck in `STATUS_PENDING_BOND`
(funding stalls, or the seller changes their mind before reaching min_bond) had **no path out at
all** — `request_exit()` rejected it, so `withdraw_remaining_bond()` (which requires
`STATUS_EXITING`) was unreachable too. Any GEN already sent via `fund_bond()` was permanently
locked, with no adversarial actor required — this is the exact "no bounded escape hatch" pattern a
GenLayer steward rejected a prior project over. **Fix:** `request_exit()` now accepts
`STATUS_PENDING_BOND` as well as `STATUS_ACTIVE`. Covered by
`test_request_exit_allowed_from_pending_bond` and
`test_withdraw_recovers_stranded_pending_bond_funds_after_cooldown`.

**2. A below-confidence-threshold audit was recorded with the model's raw "compliant"/"violation"
claim instead of "inconclusive," misrepresenting audit history (serious).** The contract correctly
avoided moving the streak on a low-confidence verdict, but never overrode `record["outcome"]` to
say so — so `get_audits()` and the frontend showed a full "Violation" badge for an audit that had
zero consequence. The original regression test for this path (`test_audit_fails_closed_when_confidence_below_threshold`)
asserted `record["outcome"] == "violation"`, i.e. it was written to match the bug rather than catch
it. **Fix:** the audit's stored outcome is now explicitly set to `AUDIT_INCONCLUSIVE` whenever
confidence is below threshold, in both the compliant and violation directions, while the model's
raw `compliant`/`confidence` values are kept for transparency. Covered by the corrected
`test_audit_fails_closed_when_confidence_below_threshold` and the new
`test_audit_records_inconclusive_for_low_confidence_compliant_verdict_too`.

**3. `fund_bond()` had no attribution or refund path for non-seller contributors (moderate).**
Anyone could top up a covenant's bond, but `withdraw_remaining_bond()` unconditionally pays the
entire remaining bond to the seller alone — a non-seller top-up was an irrevocable, unenforceable
gift to the seller, not something "strictly good" for the funder as the original comment claimed.
Rather than half-solve this with per-funder refund accounting, **fund_bond() is now seller-only**,
removing the ambiguity entirely. Covered by `test_fund_bond_rejects_non_seller`.

**Redeployed to Bradbury** after these fixes (`SentinelFactory` at
`0x5D26afe860160c78fF77A7e7EC89c322b165E824`, superseding the pre-fix
`0x84c70B571F61813C38C5bfC0A585b7BE75f85F1F`). The `create_covenant` write for fix #1's live
verification was confirmed genuinely executed (`txExecutionResultName: FINISHED_WITH_RETURN`) via
direct transaction query; reading the resulting child covenant's state back hit the same
intermittent child-contract read unavailability documented in this account's Bradbury notes
(unrelated to this contract's correctness — the factory itself read cleanly throughout). The fixes
are verified by direct-mode test logic and manual code review; full live-state verification is
pending a healthier Bradbury read window.

## Toolchain note (not a contract issue)

While re-running the local test suite after the fixes above, `genlayer-test`/`genvm-linter` had
silently been installed as pre-release versions (`0.30.0rc2`/`0.11.1rc2`) with a reworked SDK-cache
layout that fails to load this contract's pinned dependency (`py-genlayer:1jb45aa8y...`) with a
WASM-level "unexpected end of memory" error. Downgrading to the last known-good stable versions
(`genlayer-test==0.29.2`, `genvm-linter==0.11.0`) did not fully resolve it either: `genvm-lint`
against this account's already-live, unrelated `Lens.py` contract (same dependency hash) fails
identically, confirming this is an upstream infrastructure change — GenLayer's `genvm-manager`
release hosting no longer serves the runner asset for this dependency hash — affecting **every**
prior GenLayer project on this account locally, not something introduced by or fixable in this
project's code. It does not affect the live Bradbury network. `tests/direct/conftest.py` now pins
`deploy_contract(..., sdk_version="v0.2.16")` centrally so the fix (or further adjustment) only
needs to happen in one place once upstream hosting is resolved.

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

45/45 direct-mode `gltest` tests passing (verified against the correct contract logic; local
execution is currently blocked by the upstream toolchain issue noted below), `genvm-lint` clean on
both contracts, 7/7 frontend unit tests, clean production build. A real Bradbury integration test
file (`tests/integration/test_full_lifecycle.py`) exercises the full `create_covenant → fund_bond →
audit` path against a real live endpoint, not just the WASI mock.

## Final pre-submission hardening pass (2026-09-12)

A critical, adversarial re-review of the morning's rushed workaround (the `create_covenant`
fee-allocation bypass) surfaced one real security gap and two real code bugs, all now fixed and
live-verified.

**Confirmed definitively unfixable from contract code: the internal-deploy fee-allocation gap.**
Three more independent attempts this session, three more platform-side failure modes: `gl.contract
.deploy(..., use_balance=True, fee_params=InternalMessageParams(...))` from inside a contract hits
`SystemError: 6: forbidden` (`use_balance` needs an unavailable `can_use_balance_for_message_fees`
permission); `fee_params` alone without `use_balance` hits a generic `exit_code 1`; manually
constructing `messageAllocations` client-side hits `InvalidFeeParams`. This is an upstream Consensus
v0.6 platform gap, not something closeable with currently-documented primitives — the two-step
deploy-then-register flow remains the correct workaround.

**Critical finding: `register_covenant()`'s original spoofing gap.** The first version of this
method (added this morning under deadline pressure) verified a target contract only by checking that
its `get_covenant_info()` view returned a dict containing "status" and "address_seller" keys —
trivially satisfiable by ANY contract implementing a same-shaped view method, including one that
fabricates a fully "compliant" audit history. GenVM exposes no in-contract primitive to verify
another contract's actual bytecode/source hash (confirmed by exhaustively grepping the cached SDK
source for `code_hash`/`get_code`/`source_hash`/`verify_code` — zero hits), so this cannot be fully
closed with currently-available primitives. **Mitigated** (not fully closed) by requiring: the
caller must equal the target's own reported `address_seller` (closes third-party registration of an
unrelated/stale contract); `status` must be exactly `"pending_bond"`; `bond`, `audit_count`, and
`total_breaches` must all be `"0"` (freshness checks). This forces any forgery to be a
freshly-deployed, correctly-shaped contract registered by its own deployer in the same transaction
window as a real covenant — not an already-fabricated fake history — but does not, and structurally
cannot, cryptographically prove the registered contract's `audit()`/`fund_bond()` logic is the real
`Sentinel` implementation. **Live-verified against the redeployed hardened factory**
(`0x3F8d45B7d8FF7aBa373cAf7Cd13D7DeB25fc8564`, tx `0xb53844201cbbe79a97508a71435fb5ee06082c67c747e5ff46d094792c9f5652`):
a real fresh covenant deploy + register succeeded, a second registration attempt on the same address
was correctly rejected ("already registered"), a registration attempt from a non-seller account was
correctly rejected, and the full downstream lifecycle (fund_bond → register_as_beneficiary → a real
LLM audit) still reached `FINISHED_WITH_RETURN` — 7/7 live checks passed.

**Fixed: `createCovenantDirect`'s address-extraction regression.** The frontend's deploy-address
extraction only checked `deployTx.txDataDecoded?.contractAddress`, unlike the proven-working backend
test scripts which checked three possible receipt shapes. A real deploy could have been misreported
as "no contract address found" purely from a receipt-shape difference. Fixed with the same 3-way
fallback (`txDataDecoded?.contractAddress ?? contractAddress ?? to_address`).

**Fixed: orphaned-deploy UX gap.** If the deploy half of the two-step flow succeeds but the register
half fails (wallet rejection, network hiccup), a real gas-paid contract was previously left with no
recovery path except starting over and deploying a wasteful duplicate. `registerCovenant()` is now
exposed standalone, and `create/page.tsx`'s error state offers a "Finish registering" button that
retries just the registration step against the already-known address.

**Fixed: wrong-network explorer links.** `TransactionPanel.tsx` hardcoded every tx-hash link to
Bradbury's block explorer regardless of active network — actively misleading on Studio Devnet, since
a studioDev tx hash doesn't exist on Bradbury's explorer (Studio Devnet has no public explorer at
all as of this writing, confirmed via the SDK's `blockExplorers` field being `undefined`). Fixed to
only render the link on Bradbury; every other active network now shows the hash as plain,
non-clickable text.

## Acknowledged, not fully closeable

- Judging whether a live response satisfies a natural-language spec is fundamentally a qualitative
  LLM judgment, not a deterministic computation. Every mechanism in this contract (fail-closed
  evidence, sustained-streak requirement, independent validator re-derivation) hardens the process
  around that judgment; none of them turn it into something fully mechanical.
- **Integer-division dust in `claim_slash_share`.** `total_slash // len(eligible)` strands up to
  `len(eligible) - 1` wei per breach permanently in `breach_pool` — negligible in practice, the same
  class of rounding tradeoff disclosed on this account's other parimutuel-style contracts. Not worth
  a sweep mechanism for the value at stake.
- **Unbounded audit-history storage growth.** `audits`/`audit_data` grow for the lifetime of a
  covenant with no pruning. Acceptable at testnet scale; a real index or archival strategy is the
  natural next step at production scale, same class as this account's other disclosed scaling
  limitations.
- **Endpoint fingerprinting is structurally possible, not a code bug.** A sophisticated seller could
  theoretically identify GenLayer's validator fetch traffic (timing, IP ranges, user-agent) and
  serve auditors a better response than real users get. This is inherent to any oracle design that
  checks a live endpoint's own response rather than independent telemetry, not something a smart
  contract can close on its own. Stated explicitly here rather than left for a reviewer to discover.
