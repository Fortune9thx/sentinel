# Sentinel

**Live SLA truth-bonds for the agent economy.**

A seller posts a GEN bond behind their own advertised spec — uptime, latency, correctness,
whatever they claim about a live endpoint. Anyone can permissionlessly trigger an audit: GenLayer
independently fetches the real endpoint and judges it against that spec under the Equivalence
Principle, never trusting the seller's own dashboard. A single bad audit changes nothing — only a
sustained streak of confirmed violations slashes the bond into a claims pool for the buyers who
were already relying on it.

Not a payment gate. Not a status-page widget. Infrastructure for ongoing, capital-backed,
independently-verified service reliability — built for a world where AI agents increasingly buy
services from other agents with no human in the loop to catch a quiet degradation.

- **Network:** GenLayer Studio Devnet (chain 61997); Bradbury remains a legacy target
- **Contracts:** [`contracts/SentinelFactory.py`](contracts/SentinelFactory.py), [`contracts/Sentinel.py`](contracts/Sentinel.py), [`contracts/SentinelSignalsFactory.py`](contracts/SentinelSignalsFactory.py), [`contracts/SentinelSignals.py`](contracts/SentinelSignals.py)

## The trust problem

x402 and similar protocols solve *getting paid* for an agent-to-agent service. Nothing solves
*staying honest after payment clears*. A seller advertising "99.9% uptime" or "sub-200ms
responses" today can silently degrade and no buyer finds out except by getting burned
individually — there's no shared, trustless record of who's actually reliable, and no
consequence for quietly failing to keep a claim.

## The solution

```mermaid
flowchart LR
    A[Seller posts a covenant<br/>create_covenant] --> B[Bond funded<br/>fund_bond]
    B --> C[Buyers register standing<br/>register_as_beneficiary]
    C --> D[Anyone triggers an audit<br/>audit]
    D --> E[Leader fetches the live<br/>endpoint fresh]
    E --> F{Validators independently<br/>re-fetch + re-judge}
    F -->|Endpoint unreachable| K[Recorded, not a violation<br/>unless sustained]
    F -->|Compliant| G[Streak reset<br/>nothing moves]
    F -->|Violation, confident| H[Streak advances]
    H -->|3rd consecutive| I[Bond slashed into<br/>a claims pool]
    I --> J[Eligible beneficiaries<br/>claim_slash_share]
```

The seller's bond is never permanently locked either: `request_exit()` starts a fixed 72h
cooldown, after which `withdraw_remaining_bond()` recovers whatever wasn't slashed — and audits
(and slashing) stay live for the whole cooldown, so a seller can't dodge an imminent breach by
exiting the instant a bad streak starts.

No breach happens on one model's say-so — it happens only once independent validators, each
fetching the live endpoint themselves, agree the seller genuinely failed its own spec.

## Continuous audit signals

`SentinelSignals` is the same covenant plus a pool of creator-funded watch rules. Each signal
names a live endpoint, a natural-language rule, a poll interval, a per-hit reward, and an
optional stipend. Anyone may poll it; the poller is paid inline, once, and only from that
signal's pool.

```mermaid
flowchart LR
    A[Creator funds a signal<br/>create_audit_signal] --> B{Anyone polls<br/>poll_audit_signal}
    B -->|Rate limited or pool empty| X[Rejected]
    B --> C[Leader fetches endpoint<br/>and hashes body]
    C -->|Non-2xx or empty| I[Inconclusive<br/>stipend only]
    C --> E{Validators independently<br/>fetch and judge}
    E -->|Rule satisfied, confidence >= 0.6| H[Hit<br/>reward_per_hit]
    E -->|Rule absent| M[Miss<br/>stipend only]
    E -->|Low confidence| I
    H --> P[Pool decreases exactly once]
    M --> P
    I --> P
```

Payouts are Path A only: `poll_audit_signal` pays the poller during the poll and writes the
payout into the poll record. `claim_signal` deliberately always reverts, so there is no second
claim surface to double-pay. A hit never slashes the seller bond and never advances the breach
streak; only `audit()` does that.

Signals can be paused and resumed by their creator, topped up by their creator, cancelled by
their creator with a pull-based refund, or expired by anyone after `expires_at` with a
pull-based refund. Polls are rate-limited to one per `interval_seconds` (60 seconds to 30 days)
and a signal stops at 50 recorded polls.

## Why this needs GenLayer

Judging "does this live response actually satisfy this advertised spec" is a reasoning task, not
a deterministic check — it requires reading unstructured, freshly fetched content against a
natural-language claim. A single off-chain monitor making that call just relocates the trust
problem to whoever runs it. GenLayer's Equivalence Principle is what makes the judgment
cryptoeconomically trustworthy: a violation only counts once a majority of independent
validators, each doing their own fetch and their own reasoning, reach the same conclusion.

## How to use it

**1. Post a covenant** (any address may call this):

```
SentinelFactory.create_covenant(service_name, endpoint_url, spec, slash_amount, min_bond) -> address
```

**2. Fund the bond** (seller-only top-up; auto-activates once it clears `min_bond`):

```
Sentinel.fund_bond()  # payable
```

**3. Register as a relying party** (permissionless, free, timestamped):

```
Sentinel.register_as_beneficiary()
```

**4. Trigger an audit** (any address may call this — no special "auditor" role, rate-limited to
once per 5 minutes):

```
Sentinel.audit() -> audit_id
```

**5. Claim a breach share** (beneficiaries who registered before the triggering audit, pull-based):

```
Sentinel.claim_slash_share(breach_id)
```

**6. Read the live status** (no gas, anyone, including other contracts):

```
Sentinel.get_covenant_info() -> { status, bond, consecutive_failures, total_breaches, ... }
```

**7. Create a continuous audit signal** (any address on an active covenant; the sent value
seeds the pool):

```
SentinelSignals.create_audit_signal(label, endpoint_url, rule, interval_seconds, reward_per_hit, stipend, expires_at) -> signal_id  # payable
```

**8. Poll it** (any address; paid inline, exactly once per poll):

```
SentinelSignals.poll_audit_signal(signal_id) -> outcome
```

**9. Manage it** (creator-only except `expire_signal`):

```
SentinelSignals.top_up_signal(signal_id)      # payable
SentinelSignals.pause_signal(signal_id)
SentinelSignals.resume_signal(signal_id)
SentinelSignals.cancel_signal(signal_id)      # refund via claim_refund
SentinelSignals.expire_signal(signal_id)      # anyone after expiry
SentinelSignals.claim_refund()                # withdraw your refund bucket
```

Full details in [`docs/AGENT_SDK.md`](docs/AGENT_SDK.md).

## Repository structure

```
sentinel/
├── contracts/          SentinelFactory.py, Sentinel.py,
│                       SentinelSignalsFactory.py, SentinelSignals.py
├── tests/
│   ├── direct/          71 passing tests against gltest's WASI mock
│   └── integration/     Tests against a real GenLayer node (factory deploy flow)
├── frontend/            Next.js 15 App Router application
├── deploy/              Deployment scripts
├── docs/                ARCHITECTURE.md, RESOLUTION_LOGIC.md, AGENT_SDK.md, AUDIT.md
├── gltest.config.yaml
├── package.json
└── pyproject.toml
```

## Local development

```bash
# Contracts
pip install .
genvm-lint check contracts/Sentinel.py
genvm-lint check contracts/SentinelFactory.py
genvm-lint check contracts/SentinelSignals.py
genvm-lint check contracts/SentinelSignalsFactory.py
gltest tests/direct -v

# Frontend
npm install
npm run dev --workspace=frontend
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system design, storage
constraints, and rationale behind every deliberate design choice, [`docs/RESOLUTION_LOGIC.md`](docs/RESOLUTION_LOGIC.md)
for a line-by-line walkthrough of `audit()` and the breach state machine, and
[`docs/AUDIT.md`](docs/AUDIT.md) for a self-adversarial review pass calibrated against real
GenLayer reviewer rejection language.

## License

MIT
