"use client";

import { useState } from "react";
import { Code2, Check, Copy, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getSentinelFactoryAddress, isSentinelFactoryDeployed } from "@/lib/contracts";

function CodeBlock({ filename, code }: { filename: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-border-strong bg-code shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs text-white/50">
          <Code2 className="h-3 w-3" /> {filename}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1 text-xs text-white/50 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-white/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MethodRow({
  name,
  kind,
  args,
  returns,
  description,
}: {
  name: string;
  kind: "view" | "write" | "payable";
  args: string;
  returns: string;
  description: string;
}) {
  return (
    <div className="border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-sm font-semibold text-fg">{name}</code>
        <Badge variant={kind === "view" ? "neutral" : kind === "payable" ? "red" : "outline"}>{kind}</Badge>
      </div>
      <p className="mt-1.5 text-sm text-fg-secondary">{description}</p>
      <div className="mt-2 flex flex-col gap-1 font-mono text-xs text-fg-muted">
        <span>args: {args}</span>
        <span>returns: {returns}</span>
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "factory", label: "SentinelFactory reference" },
  { id: "covenant", label: "Sentinel (covenant) reference" },
  { id: "before-you-pay", label: "Checking a seller before you pay" },
  { id: "crosscontract", label: "Cross-contract reads" },
];

export default function AgentsPage() {
  const factoryAddress = getSentinelFactoryAddress();

  return (
    <div className="mx-auto flex max-w-6xl gap-12 px-6 py-16">
      <aside className="sticky top-24 hidden h-fit w-48 shrink-0 lg:block">
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">On this page</p>
        <nav className="mt-3 flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-lg px-2 py-1.5 text-sm text-fg-secondary hover:bg-bg-subtle hover:text-fg">
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-red">
          <Terminal className="h-4 w-4" /> Agent SDK
        </p>
        <h1 className="display-heading mt-2 text-3xl text-fg sm:text-4xl">
          Check a seller&rsquo;s track record. Trigger an audit yourself. No middleman.
        </h1>
        <p className="mt-4 max-w-2xl text-fg-secondary">
          Sentinel exposes every capability through plain GenLayer Intelligent Contract calls — the same
          interface this app itself uses. An autonomous agent deciding whether to pay a service can read a
          covenant&rsquo;s live status directly, or trigger a fresh audit itself before committing to payment.
        </p>

        <section id="overview" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-semibold text-fg">Overview</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-secondary">
            Sentinel is a two-contract system. <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-xs">SentinelFactory</code> is
            the registry — it deploys a fresh <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-xs">Sentinel</code> contract
            per posted covenant and indexes them for discovery. Each <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-xs">Sentinel</code> contract
            is fully self-contained: it holds its own bond, audit history, and breach records. An agent
            that already knows a covenant address never needs to touch the factory again.
          </p>
          <div className="mt-4 rounded-xl border border-border bg-bg-subtle p-4 text-sm">
            <p className="font-medium text-fg">Current deployment</p>
            <p className="mt-1 font-mono text-xs text-fg-secondary">
              {isSentinelFactoryDeployed() ? `SentinelFactory: ${factoryAddress}` : "SentinelFactory not deployed on this environment yet."}
            </p>
            <p className="mt-1 text-xs text-fg-muted">Network: GenLayer Bradbury Testnet</p>
          </div>
        </section>

        <section id="quickstart" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-semibold text-fg">Quickstart</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-secondary">
            Reading is free, keyless, and requires no wallet — <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-xs">createClient</code> with
            no <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-xs">account</code> is a genuine read-only client, not a stub.
          </p>
          <div className="mt-5">
            <CodeBlock
              filename="read-covenant-status.ts"
              code={`import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const client = createClient({ chain: testnetBradbury });

const COVENANT_ADDRESS = "0x..."; // any deployed Sentinel covenant

const info = await client.readContract({
  address: COVENANT_ADDRESS,
  functionName: "get_covenant_info",
  args: [],
});

console.log(info.status, info.bond, info.total_breaches);`}
            />
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-fg-secondary">
            Writing (funding a bond, registering as a beneficiary, or triggering an audit) needs a signer.
            Bind whichever EIP-1193 provider your wallet or agent key actually uses — never a fresh
            ephemeral account per call.
          </p>
          <div className="mt-5">
            <CodeBlock
              filename="run-audit.ts"
              code={`import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

// An agent typically holds its own key -- createAccount(privateKey)
// rather than a browser wallet's injected provider.
const account = createAccount(process.env.AGENT_PRIVATE_KEY);

const client = createClient({
  chain: testnetBradbury,
  account,
});

const hash = await client.writeContract({
  address: COVENANT_ADDRESS,
  functionName: "audit",
  args: [],
  value: 0n,
  // audit() is the heaviest call in this contract -- a live fetch plus an
  // independently-re-derived LLM judgment per validator.
  consensusMaxRotations: 5,
});

const tx = await client.waitForTransactionReceipt({ hash });`}
            />
          </div>
        </section>

        <section id="factory" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-semibold text-fg">SentinelFactory reference</h2>
          <div className="mt-4 card-surface p-6">
            <MethodRow name="create_covenant" kind="payable" args="service_name: str, endpoint_url: str, spec: str, slash_amount: u256, min_bond: u256" returns="address (the new covenant contract)" description="Deploys a fresh, unfunded Sentinel covenant. Requires the configured creation stake as tx value." />
            <MethodRow name="get_covenants" kind="view" args="—" returns="list[str] (addresses, oldest first)" description="Every covenant address ever created by this factory." />
            <MethodRow name="get_covenant_meta" kind="view" args="address: str" returns="dict" description="Cached creation-time metadata for one covenant (service name, endpoint, spec, seller)." />
            <MethodRow name="get_covenants_by_seller" kind="view" args="seller_address: str" returns="list[str]" description="Every covenant posted by one seller." />
            <MethodRow name="get_creation_stake" kind="view" args="—" returns="str (wei)" description="The GEN amount required to post a new covenant." />
          </div>
        </section>

        <section id="covenant" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-semibold text-fg">Sentinel (covenant) reference</h2>
          <div className="mt-4 card-surface p-6">
            <MethodRow name="get_covenant_info" kind="view" args="—" returns="dict" description="The single most important call for external readers: status, bond, streak, and breach counts." />
            <MethodRow name="fund_bond" kind="payable" args="—" returns="—" description="Permissionless top-up of the covenant's bond. Auto-activates the covenant once bond clears min_bond." />
            <MethodRow name="register_as_beneficiary" kind="write" args="—" returns="—" description="Permissionless, free, timestamped registration as a party relying on this service -- required before a breach to be eligible for its claims pool." />
            <MethodRow name="audit" kind="write" args="—" returns="str (audit id)" description="Triggers an independently-verified live audit against the endpoint and spec. Rate-limited to once per 5 minutes." />
            <MethodRow name="get_audits" kind="view" args="—" returns="list[dict]" description="History of every audit this covenant has run, most recent last." />
            <MethodRow name="get_breaches" kind="view" args="—" returns="list[dict]" description="History of every confirmed breach and its slash amount." />
            <MethodRow name="claim_slash_share" kind="write" args="breach_id: str" returns="—" description="Pulls the caller's equal share of a breach's slashed pool, if they were an eligible beneficiary." />
            <MethodRow name="get_claimable" kind="view" args="breach_id: str, address: str" returns="str (wei)" description="Preview an address's claimable share for a breach before claiming." />
          </div>
        </section>

        <section id="before-you-pay" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-semibold text-fg">Checking a seller before you pay</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-secondary">
            A covenant never pushes its status anywhere. Any agent deciding whether to pay a service reads
            it explicitly, on its own schedule — the same pull-based pattern Sentinel itself uses internally.
          </p>
          <div className="mt-5">
            <CodeBlock
              filename="check-before-pay.ts"
              code={`// Inside your own agent's payment decision loop:
const info = await client.readContract({
  address: COVENANT_ADDRESS,
  functionName: "get_covenant_info",
  args: [],
});

if (info.status !== "active") return; // not bonded, or exiting -- don't rely on it

if (Number(info.total_breaches) > 0) return; // has a confirmed breach history

// Optionally trigger a fresh audit yourself instead of trusting a stale one:
// await client.writeContract({ ..., functionName: "audit", args: [] });

// Safe to proceed with payment.`}
            />
          </div>
        </section>

        <section id="crosscontract" className="mt-14 scroll-mt-24 pb-8">
          <h2 className="text-xl font-semibold text-fg">Cross-contract reads (from another GenLayer contract)</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-secondary">
            A GenLayer Intelligent Contract can read a covenant&rsquo;s status directly via <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-xs">.view()</code> —
            the verified-reliable cross-contract call shape on Bradbury. This must happen outside any
            nondeterministic block, never inside one.
          </p>
          <div className="mt-5">
            <CodeBlock
              filename="MyContract.py"
              code={`from genlayer import *
import genlayer.gl as gl

class MyContract(gl.Contract):
    @gl.public.write
    def pay_if_trustworthy(self, covenant_address: str):
        info = gl.get_contract_at(Address(covenant_address)).view().get_covenant_info()
        if info["status"] != "active":
            raise gl.vm.UserError("Covenant is not active.")
        if int(info["total_breaches"]) > 0:
            raise gl.vm.UserError("Seller has a confirmed breach on record.")

        # ... proceed with your own payment logic`}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
