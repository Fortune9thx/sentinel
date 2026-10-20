# Agent SDK

Sentinel exposes every capability through plain GenLayer Intelligent Contract calls — there is no
separate API, no API key, and no indexer required. Any agent or contract can read a covenant's live
status directly, or write to it, using nothing more than `genlayer-js` (or the equivalent in any
GenLayer SDK).

## Why this matters for agents specifically

An autonomous agent buying a service from another agent (over x402 or any similar protocol) has no
native way today to check whether the seller has kept its own claims. Sentinel gives that agent a
single, cheap read to check before paying, and a single write to trigger its own fresh audit if the
cached record looks stale.

## Reading (no wallet required)

```ts
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const client = createClient({ chain: testnetBradbury });

const info = await client.readContract({
  address: COVENANT_ADDRESS,
  functionName: "get_covenant_info",
  args: [],
});
```

`get_covenant_info()` returns:

```ts
{
  address_seller: string;
  service_name: string;
  endpoint_url: string;
  spec: string;
  slash_amount: string;      // wei
  min_bond: string;          // wei
  bond: string;               // wei, current
  status: "pending_bond" | "active" | "exiting" | "exited";
  created_at: string;         // unix seconds
  exit_requested_at: string;  // "0" until requested
  audit_count: string;
  last_audit_at: string;
  consecutive_failures: string;
  total_violations: string;
  total_breaches: string;
  beneficiary_count: number;
}
```

## Writing (needs a signer)

```ts
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const account = createAccount(process.env.AGENT_PRIVATE_KEY);
const client = createClient({ chain: testnetBradbury, account });

const hash = await client.writeContract({
  address: COVENANT_ADDRESS,
  functionName: "audit",
  args: [],
  value: 0n,
  consensusMaxRotations: 5, // audit() is the heaviest call -- give it room
});

const tx = await client.waitForTransactionReceipt({ hash });
```

## SentinelFactory reference

| Method | Kind | Args | Returns |
| --- | --- | --- | --- |
| `create_covenant` | payable | `service_name: str, endpoint_url: str, spec: str, slash_amount: u256, min_bond: u256` | `address` |
| `withdraw_fees` | write | — | — (owner only) |
| `get_owner` | view | — | `str` |
| `get_creation_stake` | view | — | `str` (wei) |
| `get_collected_fees` | view | — | `str` (wei) |
| `get_covenants` | view | — | `list[str]` |
| `get_covenants_count` | view | — | `int` |
| `get_covenants_page` | view | `offset: int, limit: int` | `list[str]` |
| `get_covenant_meta` | view | `address: str` | `dict` |
| `get_covenants_by_seller` | view | `seller_address: str` | `list[str]` |

## Sentinel (covenant) reference

| Method | Kind | Args | Returns |
| --- | --- | --- | --- |
| `fund_bond` | payable | — | — (seller-only top-up, auto-activates) |
| `register_as_beneficiary` | write | — | — (permissionless, free) |
| `audit` | write | — | `str` (audit id) |
| `claim_slash_share` | write | `breach_id: str` | — |
| `request_exit` | write | — | — (seller only) |
| `withdraw_remaining_bond` | write | — | — (seller only, after 72h cooldown) |
| `get_covenant_info` | view | — | `dict` |
| `get_audit` | view | `audit_id: str` | `dict` |
| `get_audits` | view | — | `list[dict]` |
| `get_breach` | view | `breach_id: str` | `dict` |
| `get_breaches` | view | — | `list[dict]` |
| `is_beneficiary` | view | `address: str` | `bool` |
| `get_claimable` | view | `breach_id: str, address: str` | `str` (wei) |
| `is_claimed` | view | `breach_id: str, address: str` | `bool` |

## SentinelSignals (continuous audit signals) reference

Deploy `contracts/SentinelSignals.py` directly (same constructor args as `Sentinel.py`) or
register it through `SentinelSignalsFactory`. All bond/audit/breach methods above still exist
unchanged.

| Method | Kind | Args | Returns |
| --- | --- | --- | --- |
| `create_audit_signal` | payable | `label: str, endpoint_url: str, rule: str, interval_seconds: u256, reward_per_hit: u256, stipend: u256, expires_at: u256` | `str` (signal id); sent value seeds the pool |
| `poll_audit_signal` | write | `signal_id: str` | `str` (poll id); pays the poller inline, exactly once |
| `top_up_signal` | payable | `signal_id: str` | `-` (creator only; reactivates an exhausted signal) |
| `pause_signal` | write | `signal_id: str` | `-` (creator only) |
| `resume_signal` | write | `signal_id: str` | `-` (creator only) |
| `cancel_signal` | write | `signal_id: str` | `-` (creator only; refund is pull-based) |
| `expire_signal` | write | `signal_id: str` | `-` (anyone after `expires_at`; refund is pull-based) |
| `claim_refund` | write | `-` | `-` (sender's accumulated signal refunds) |
| `claim_signal` | write | `signal_id: str` | always reverts; payouts happen only in `poll_audit_signal` |
| `get_signal` | view | `signal_id: str` | `dict` |
| `get_signals` | view | `-` | `list[dict]` (latest 50) |
| `get_signals_page` | view | `offset: int, limit: int` | `list[dict]` |
| `get_signals_by_covenant` | view | `covenant_address: str` | `list[dict]` (self only) |
| `get_signal_polls` | view | `signal_id: str` | `list[dict]` (latest 50) |
| `get_signal_refund` | view | `address: str` | `str` (wei) |
| `get_signal_count` | view | `-` | `int` |

A poll outcome is `hit`, `miss`, or `inconclusive`. A `hit` pays `reward_per_hit`; the other
outcomes pay `stipend`; every payout is clamped to the remaining pool. Confidence below 0.6,
non-2xx HTTP, empty bodies, and fetch failures are `inconclusive`. A hit never slashes the bond
or advances the breach streak.

## Checking a seller before you pay

```ts
const info = await client.readContract({
  address: COVENANT_ADDRESS,
  functionName: "get_covenant_info",
  args: [],
});

if (info.status !== "active") return;           // not bonded, or exiting
if (Number(info.total_breaches) > 0) return;     // confirmed breach on record

// Optionally trigger a fresh audit before committing to payment:
// await client.writeContract({ address: COVENANT_ADDRESS, functionName: "audit", args: [], value: 0n });
```

## Cross-contract reads (from another GenLayer contract)

```python
from genlayer import *
import genlayer.gl as gl

class MyContract(gl.Contract):
    @gl.public.write
    def pay_if_trustworthy(self, covenant_address: str):
        info = gl.get_contract_at(Address(covenant_address)).view().get_covenant_info()
        if info["status"] != "active":
            raise gl.vm.UserError("Covenant is not active.")
        if int(info["total_breaches"]) > 0:
            raise gl.vm.UserError("Seller has a confirmed breach on record.")
        # ... proceed with your own payment logic
```

This must happen outside any nondeterministic block (`gl.get_contract_at(...).view()` is a
deterministic cross-contract read, confirmed reliable on Bradbury), never inside a
`run_nondet_unsafe`/`run_nondet` closure.
