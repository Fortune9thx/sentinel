# Sentinel continuous signals - full E2E test guide

This is the exact guide used for the live Studio Devnet run on 2026-10-20. Every address and
transaction hash below is real, not a placeholder.

## What the E2E proves

| Claim | How it is proven |
| --- | --- |
| A covenant can be deployed and registered | Deploy + `register_covenant` + `get_covenant_meta` |
| The seller can fund the bond | `fund_bond` with 10 wei, status becomes `active` |
| A creator can fund a signal | `create_audit_signal` with a 10 wei pool |
| A poll returns a real judgment and pays once | `poll_audit_signal` -> `hit`, payout 4 wei, pool 6 wei |
| A second immediate poll is rate-limited | `poll_audit_signal` -> `FINISHED_WITH_ERROR` |
| `claim_signal` cannot double-pay | `claim_signal` -> `FINISHED_WITH_ERROR`, pool unchanged |
| Pause blocks polling | `pause_signal` -> paused, poll -> `FINISHED_WITH_ERROR` |
| Resume and top-up work | `resume_signal`, `top_up_signal` -> pool 11 wei |
| Cancel creates a pull refund | `cancel_signal` -> refund bucket 11 wei |
| Refund can be withdrawn exactly once | `claim_refund` -> refund 0 |
| Expiry refunds the remainder | `expire_signal` -> expired, refund 3 wei, `claim_refund` -> 0 |

## 0. Preconditions

From the repository root:

```bash
node --version          # v22.x used for the recorded run
python --version        # 3.11+ used by gltest
npm install             # only if node_modules is missing
```

`.env` must contain one deployer key:

```text
BRADBURY_DEPLOY_PRIVATE_KEY=0x...
```

The signer used for the recorded run:

```text
0xC6E6d3b2acCaECeCeB40Ad4bD3dF123DDCB4e537
```

Funds: the signer needs GEN on Studio Devnet. The run used small wei amounts for contract value;
the per-transaction fee is the larger cost.

## 1. Local checks before spending gas

```bash
genvm-lint check contracts/SentinelSignals.py
genvm-lint check contracts/SentinelSignalsFactory.py
gltest tests/direct -q
```

Expected:

```text
Lint passed (3 checks)
71 passed
```

The linter's validation stage may fail in a fresh shell with
`Failed to load SDK: runner py-genlayer:... not found`. That is a local runner-cache gap; live
deployment still works.

## 2. Full on-chain E2E (one command)

```bash
npx tsx deploy/003_e2e_signals.ts
```

The script uses the factory at:

```text
0x69FeCf753243F6DE8E202E2Ea499B04A389ACc98
```

It deploys a fresh `SentinelSignals` covenant, registers it, and runs the complete lifecycle.
Each step asserts its expected result and aborts on the first mismatch.

### Recorded run result

```text
E2E signer: 0xC6E6d3b2acCaECeCeB40Ad4bD3dF123DDCB4e537
Factory: 0x69FeCf753243F6DE8E202E2Ea499B04A389ACc98
Source: 47735 bytes
```

| Step | Transaction | Result |
| --- | --- | --- |
| 1. Deploy covenant | `0x733f694d5cb57338c0215e1a4c5dfe220408608c080661096dcebebbddfa8267` | `FINISHED_WITH_RETURN` |
| 2. Register with factory | `0x7198db0a14463e88cba5a516ace17f3c3d48fb0814fbb2883de175fda1ae5533` | `FINISHED_WITH_RETURN`; meta returned |
| 3. Fund bond (10 wei) | `0xb82926cab70267e1837f37a379d7cefbfacb68e91b7eb29e880e5719b478492f` | `active`, bond 10 |
| 4. Create signal #0 (pool 10, reward 4, stipend 1) | `0xaa8d7604d69bdcd0cea6e0c34cfda75fcaedf56051e9c0eb37a7b231f5368a4f` | signal id `0` |
| 5. Create signal #1 (pool 3, reward 1, expires in 60s) | `0x4de14efe1716be6fabe7c0790825965c6f89e136b500bf9986bb71576bfda656` | signal id `1` |
| 6. Poll signal #0 | `0x4c88322b42034541529a47fa412ea7fafa5625011dbc70dd380614a8fd12ca69` | `hit`, payout 4 wei, pool 6, `poll_count=1`, `payout_count=1` |
| 7. Immediate second poll | `0x8267d75abf83353f3d2ba46194b48e58c31f154d635619fe02418ec322cb7c7e` | `FINISHED_WITH_ERROR` (rate limit) |
| 8. `claim_signal` | `0xc346c0d39edb7be90a7e37ccc347cbdc78639fbee815717ffcbe046e31a8e6d2` | `FINISHED_WITH_ERROR`; pool still 6, total paid still 4 |
| 9. Pause | `0x9a2abf92e7e55f13f29fdb2782c124fa74800d3bd5bd14a7459dcccf9727dfa3` | `paused` |
| 9b. Poll while paused | `0x93679a8e0b46a4d38fd57eb82194faf72aad655361a9679d1f5eb5c68354ef02` | `FINISHED_WITH_ERROR` |
| 10. Resume | `0x6f07bdb2622c01d158b975e252efc24263714e33fc2efabbcbf9764900911d4c` | `active` |
| 10b. Top up (5 wei) | `0x55ace8f1ebcf8e15c783f6f55bdf9c4a5af64f2b90ae07dab8e47cb80b6b933a` | pool 11 |
| 11. Cancel | `0x07ce067dc17f5579c1564d325dc8a8e5672b1da3393b6dd782fbc7d5ee75fd91` | `cancelled`, refundable 11 |
| 11b. Poll after cancel | `0xdfa8eb4fc9e7c4ade3e24da3485e6079d359b3887700756223cd3eced61ecfd0` | `FINISHED_WITH_ERROR` |
| 12. Claim refund | `0x7283af71d5d94aa3b5501d3daac76ccfafad89cb2feb998277092121c40aba89` | refund 11 -> 0 |
| 13. Expire signal #1 | `0xad0da144f06a24b3a4bc244022659cd6070e4c4bef259e61510accde4756267f` | `expired`, refundable 3 |
| 13b. Claim expiry refund | `0x323c42583c1b5fd1682076a345a058e5b6d942784b1bcf3f16d7be5b2ca47874` | refund 3 -> 0 |

### Final state from the recorded run

```json
{
  "covenant": "0x43aBBad9C074105Fa9382b8BEd20dbfB41F8f480",
  "count": 2,
  "signal0": {
    "status": "cancelled",
    "last_outcome": "hit",
    "hit_count": "1",
    "poll_count": "1",
    "payout_count": "1",
    "total_paid": "4",
    "pool_remaining": "0",
    "refunded": "11"
  },
  "signal1": {
    "status": "expired",
    "poll_count": "0",
    "total_paid": "0",
    "pool_remaining": "0",
    "refunded": "3"
  },
  "covenantInfo": {
    "status": "active",
    "bond": "10",
    "total_breaches": "0"
  }
}
```

Expected terminal line:

```text
E2E PASSED
Covenant: 0x43aBBad9C074105Fa9382b8BEd20dbfB41F8f480
Deploy tx: 0x733f694d5cb57338c0215e1a4c5dfe220408608c080661096dcebebbddfa8267
```

## 3. Manual frontend E2E

Use the recorded covenant:

```text
0x43aBBad9C074105Fa9382b8BEd20dbfB41F8f480
```

Open:

```text
https://sentinel-x9.vercel.app/covenants/0x43aBBad9C074105Fa9382b8BEd20dbfB41F8f480/signals
```

### Step 1 - connect

1. Click "Connect Wallet".
2. Choose the wallet that holds the deployer key.
3. Approve the Studio Devnet chain switch if prompted. The app only configures chain `61997`.
4. Expected: no yellow warning under the page title. If it says "Switch your wallet to GenLayer
   Studio Dev (chain 61997)", switch networks and refresh.

### Step 2 - confirm the recorded signals are visible

Expected cards:

- Signal #0: status `cancelled`, last outcome `hit`, 1 poll, 4 wei paid, pool 0.
- Signal #1: status `expired`, 0 polls, pool 0.

Click "Polls" on signal #0. Expected: one poll card with badge `hit`, payout `4` wei on-chain
(the UI's 4-decimal GEN formatter shows this tiny amount as `0 GEN`), reasoning about the
Example Domain body, fingerprint
`25ddf2c883e0d1958ea971d279a7e4f0fd446724ee3db7db19dadabd4a62e484`, confidence 100%.

### Step 3 - create a new active signal

1. Click "New signal".
2. Covenant address is prefilled with `0x43aBBad9C074105Fa9382b8BEd20dbfB41F8f480`.
3. Fill:

```text
Signal label:            UI E2E probe
Poll interval (minutes): 1
Watched endpoint URL:    https://example.com
Watch rule:              The response body contains the phrase Example Domain.
Reward per hit (GEN):    0.001
Stipend per non-hit:     0.0001
Initial pool (GEN):      0.01
Expires at:              leave the default (7 days)
```

4. Click "Fund signal".
5. Expected: TransactionPanel moves `submitting` -> `polling` -> `Signal funded`, then redirects
   to the covenant signals page. A third card appears, status `active`, pool `0.01 GEN`.

If the button is disabled, read the yellow gate message. It must be connected, on chain 61997,
and able to read the covenant schema.

### Step 4 - poll and verify the payout

1. On the new active card, click "Poll".
2. Wait for consensus. Expected: `Poll confirmed`.
3. Expected card: last outcome `hit` (or `miss`/`inconclusive` if the model disagrees), polls 1,
   pool reduced by the reward on a hit.
4. Open "Polls". Expected: one poll record with a non-empty reasoning, fingerprint, poller, and
   the exact payout.

On the recorded run the same contract-level path paid exactly 4 wei for a 4 wei reward and left
the pool at 6 wei.

### Step 5 - prove rate limiting

1. Immediately click "Poll" again.
2. Expected: error panel, not a success panel. The contract rejects with
   `Signal polls are rate-limited to one per interval_seconds.`
3. Refresh. Expected: `poll_count` is still 1 and the pool did not change.

### Step 6 - pause, resume, top up

1. On the active card, click "Pause". Expected: status `paused`, Poll button disappears.
2. Click "Resume". Expected: status `active`, Poll button returns.
3. In the "Top up (GEN)" field enter `0.005`, click "Add to pool".
4. Expected: pool increases by exactly 0.005 GEN.

### Step 7 - cancel and refund

1. Click "Cancel". Expected: status `cancelled`, Poll button disappears.
2. Expected: a refund banner appears: "You have X GEN in unclaimed signal refunds."
3. Click "Claim refund". Expected: `Refund confirmed`, banner disappears.
4. Reload. Expected: no refund banner, cancelled signal still shows its final poll history.

### Step 8 - optional expiry flow

The automated script already proved this on signal #1. To repeat in the UI, create a signal with
an expiry a few minutes out, wait past it, then call `expire_signal` from a script or the
explorer. The UI does not expose an "Expire" button because anyone may call it and it only
moves the remainder to the creator's pull-refund bucket.

## 4. Explorer verification

Open these and confirm the status and decoded method:

```text
Factory:
https://explorer-studio-dev.genlayer.com/address/0x69FeCf753243F6DE8E202E2Ea499B04A389ACc98

E2E covenant:
https://explorer-studio-dev.genlayer.com/address/0x43aBBad9C074105Fa9382b8BEd20dbfB41F8f480

Single-payout poll:
https://explorer-studio-dev.genlayer.com/tx/0x4c88322b42034541529a47fa412ea7fafa5625011dbc70dd380614a8fd12ca69

Double-pay attempt (reverted):
https://explorer-studio-dev.genlayer.com/tx/0xc346c0d39edb7be90a7e37ccc347cbdc78639fbee815717ffcbe046e31a8e6d2

Rate-limited poll (reverted):
https://explorer-studio-dev.genlayer.com/tx/0x8267d75abf83353f3d2ba46194b48e58c31f154d635619fe02418ec322cb7c7e
```

## 5. Negative tests covered by the direct suite

The live run covers the creator-controlled lifecycle. The direct suite covers the checks that
need a second funded identity or controlled clock:

- non-creator cannot pause, cancel, or top up;
- cancel/expiry refunds are pull-only;
- expired signals cannot be polled;
- low-confidence hit is recorded as inconclusive, not a hit;
- non-2xx and empty bodies are inconclusive and pay only the stipend;
- a hit never slashes the bond or advances the breach streak;
- top-up reactivates an exhausted pool;
- `claim_signal` cannot double-pay;
- factory rejects a missing signals source.

Run them with:

```bash
gltest tests/direct -q
```

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Button disabled with chain warning | Wallet is not on 61997 | Switch network to Studio Dev |
| "No readable SentinelSignals schema" | Address is not a signals covenant, or RPC is down | Use `0x43aB...` or redeploy |
| `estimateTransactionFees` fails | RPC hiccup | Retry; the scripts call it per write |
| Poll succeeds as `inconclusive` | Model confidence below 0.6 or endpoint not judgeable | Use a clearly observable rule |
| `claim_signal` errors | Expected | It always reverts; payment is in the poll |
| Linter validation fails | Local runner cache missing | Lint check still passes; live deploy is the proof |

## 7. Recorded artifacts

- `deploy/003_e2e_signals.ts` - the reproducible full-lifecycle script.
- `deploy/deployments.json` - factory, live proof, and this E2E run with full tx hashes.
- `docs/signals-milestone.md` - milestone summary.
- `tests/direct/test_signals.py` - 10 signal tests, including the single-payout regression.
