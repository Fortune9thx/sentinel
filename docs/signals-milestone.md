# Sentinel milestone: continuous audit signals

## Summary

Sentinel already let anyone audit a seller's live endpoint against a bonded, natural-language
spec. This milestone adds **Continuous Audit Signals**: creator-funded, interval-gated watch
rules attached to an existing covenant, where anyone can poll the watched endpoint and be paid
inline, exactly once per poll.

The key invariant is single-surface payout. `poll_audit_signal` is the only path that can move a
signal's pool to a caller. `claim_signal` exists only to revert, so there is no second claim
surface that could double-pay the same poll. A hit pays `reward_per_hit`; a miss or an
inconclusive poll pays `stipend`; every payout is clamped to the remaining pool.

The accepted `contracts/Sentinel.py` is untouched. Signals ship as a separate superset contract,
`contracts/SentinelSignals.py`, plus a new registry, `contracts/SentinelSignalsFactory.py`.

## Live deployment (GenLayer Studio Devnet, chain 61997)

| Item | Value |
| --- | --- |
| New factory | `0x69FeCf753243F6DE8E202E2Ea499B04A389ACc98` |
| Factory deploy tx | `0x520aa70d3d79243e1a061752335d9d41f6bf1edea6bd6732c12e57b94df8b75b` |
| Factory status | `FINALIZED` / `FINISHED_WITH_RETURN` |
| Factory source | `contracts/SentinelSignalsFactory.py` (19,137 bytes, LF) |
| Embedded covenant source | `contracts/SentinelSignals.py` (47,735 bytes, LF) |
| Superseded factory | `0xb6DB0D4800733F96916C4ceE544A0065771617DD` |
| Live app | https://sentinel-x9.vercel.app/ |

Explorer:
https://explorer-studio-dev.genlayer.com/address/0x69FeCf753243F6DE8E202E2Ea499B04A389ACc98

## Live end-to-end proof

A real covenant was deployed directly, funded, given a signal, and polled against
`https://example.com` on Studio Devnet.

| Step | Transaction | Result |
| --- | --- | --- |
| Deploy `SentinelSignals` | `0x57d441888c1b8ed8f5969d957dc8971379fc2980bc7acf6452558ee3e7dfe97d` | `FINISHED_WITH_RETURN` |
| Fund bond | `0xde98b828023b42e6368b68f026c42bdad5a202e845a60a63cda56589147b2fb0` | `FINISHED_WITH_RETURN` |
| Create signal (10 wei pool, 2 wei reward) | `0x63268ec5fe152ed420da08a8c351a5cc343a2dfa7800ec8db849b84af577e5b1` | `FINISHED_WITH_RETURN` |
| Poll signal | `0x5551037d972226ac8c328053561bfafbbb4728736a278120d41643248db9d116` | `hit`, confidence `1.0`, payout `2 wei`, pool `8 wei`, `poll_count=1`, `payout_count=1` |
| Attempt `claim_signal` | `0x535c957840f50b1fc52666fe1509c54dd815faa17e621a069044531528c2c594` | `FINISHED_WITH_ERROR` (always reverts) |

Live covenant:
`0x2361AA8531DFc9Db017c5866360a38399B64b26D`

Signal detail page:
https://sentinel-x9.vercel.app/signals/0?covenant=0x2361AA8531DFc9Db017c5866360a38399B64b26D

The factory registration path was also exercised with a second fresh signals covenant:

| Step | Transaction | Result |
| --- | --- | --- |
| Deploy signals covenant | `0x32c320a94d67fc40f7eaa16207b808c0e1d6e1cb688fb9613749bbc073c519d6` | `FINISHED_WITH_RETURN` |
| Register with new factory | `0x46aad5eb9c95da2e72dfa20284b2019504dd68daba62874e65a486e68b32d475` | `FINISHED_WITH_RETURN`, `get_covenant_meta` returns the record |

Registry probe covenant:
`0xd73Fc8032Ba7323d4FCC4FE7F48624B3a7F93C3f`

A full lifecycle run (deploy, register, fund, create two signals, poll, rate-limit rejection,
double-pay rejection, pause, resume, top-up, cancel, refund, expiry, refund) passed against
covenant `0x43aBBad9C074105Fa9382b8BEd20dbfB41F8f480`. The exact step-by-step guide and every
transaction hash are in [`docs/E2E_SIGNALS.md`](E2E_SIGNALS.md).

## What changed

### Contracts

- `contracts/SentinelSignals.py`
  - Adds `signal_ids`, `signal_data`, `signal_pool`, `signal_polls`, `signal_refund`,
    `signal_claims`, and `signal_count`.
  - `create_audit_signal`: payable creator-funded pool with label, endpoint URL, watch rule,
    interval (60 seconds to 30 days), reward, stipend, and future expiry.
  - `poll_audit_signal`: permissionless, rate-limited to one per interval, fetches the endpoint
    with `gl.nondet.web.get`, records a SHA-256 body fingerprint, judges a sanitized excerpt with
    a confidence threshold of 0.6, and pays the poller in the same transaction.
  - `top_up_signal`, `pause_signal`, `resume_signal`, `cancel_signal` are creator-gated.
  - `expire_signal` is callable by anyone after expiry.
  - `cancel_signal` / `expire_signal` move the remainder into a pull-based refund bucket;
    `claim_refund` withdraws it.
  - `claim_signal` always reverts by design.
  - A signal hit never slashes the seller bond and never advances the breach streak.
  - Keeps the entire accepted bond/audit/breach lifecycle unchanged.
- `contracts/SentinelSignalsFactory.py`
  - Registry with the same two-tier `register_covenant` / `verify_covenant` shape as the existing
    factory, embedding the signals source as a constructor argument.

### Frontend

- Signal reads/writes in `frontend/lib/sentinel-calls.ts`.
- Shared gate in `frontend/lib/useSignalWriteGate.ts`: connected wallet, chain 61997, and a
  non-empty `getContractSchema` for the target address.
- `requireAgree` support in `frontend/lib/useTransactionLifecycle.ts`: signal writes must return
  `AGREE` or `MAJORITY_AGREE`.
- New routes:
  - `/covenants/[address]/signals`
  - `/signals/new`
  - `/signals/[id]`
- The covenant page now links to its signals.

## Verification

```text
gltest tests/direct -q
71 passed

genvm-lint check contracts/SentinelSignals.py
Lint passed (3 checks)
# Validation stage cannot load the local py-genlayer runner cache; this is a
# toolchain cache gap in this environment, not a contract failure.

npx tsc -p frontend/tsconfig.json --noEmit
# clean

npx eslint lib app
# clean

npm run build --workspace=frontend
# compiled successfully; new routes emitted

npm run test --workspace=frontend
# 7 passed
```

The direct suite includes the required regression:
`test_poll_audit_signal_pays_exactly_once_per_poll_and_claim_cannot_double_pay`.

## Reproduce

```bash
# 1. Lint and test
genvm-lint check contracts/SentinelSignals.py
genvm-lint check contracts/SentinelSignalsFactory.py
gltest tests/direct -q

# 2. Deploy the new factory to Studio Devnet
#    (reads PRIVATE_KEY or BRADBURY_DEPLOY_PRIVATE_KEY)
npx tsx deploy/002_deploy_sentinel_signals_factory.ts studio-dev

# 3. Run the frontend
npm run dev --workspace=frontend
```

The deployment record is committed at `deploy/deployments.json`.

## Honest limits

- `create_covenant` on the new factory was not exercised live; the supported live path is
  deploying `SentinelSignals.py` directly and calling `register_covenant`, which is the path the
  frontend uses and the path verified above.
- The registry probe is registered but not owner-verified, so `is_covenant_verified` is `false`
  for that probe. That is the two-tier design, not a failed registration.
- Signals are enumerated per covenant; there is no global cross-covenant signal index.
- Poll history is capped at the latest 50 records per signal. Pool accounting is unaffected.
- `genvm-lint` validation is blocked locally by a missing cached runner. Lint checks and live
  deployment both pass.
