"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Radar,
  Users,
  Gavel,
  Code2,
  ShieldCheck,
  Globe,
  Bot,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveStats } from "@/components/LiveStats";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Post a covenant",
    body: "A seller declares a live endpoint and an advertised spec — uptime, latency, correctness, whatever they claim — and posts a GEN bond behind it.",
  },
  {
    icon: Users,
    title: "Buyers register standing",
    body: "Anyone relying on the service registers as a beneficiary, permissionlessly and free, timestamped so eligibility can never be gamed after the fact.",
  },
  {
    icon: Radar,
    title: "Anyone triggers an audit",
    body: "GenLayer independently fetches the live endpoint and judges it against the spec under the Equivalence Principle — never trusting the seller's own dashboard.",
  },
  {
    icon: Gavel,
    title: "Sustained failure slashes",
    body: "A single bad audit changes nothing. A confirmed streak slashes the bond into a claims pool split among the beneficiaries who were already relying on it.",
  },
];

const AUDIENCES = [
  {
    icon: Bot,
    title: "Agent-to-agent services",
    body: "An AI agent selling inference, data, or execution to other agents over x402 or similar can post a covenant as a portable, trustless reliability record.",
  },
  {
    icon: Globe,
    title: "Public API operators",
    body: "Any live HTTP endpoint with a real advertised spec — uptime, latency, response shape — can be held to it without a centralized status-page middleman.",
  },
  {
    icon: Building2,
    title: "DAOs and treasuries",
    body: "A treasury paying a service provider can require a standing covenant instead of trusting self-reported SLA compliance before renewing a contract.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* ---------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden bg-bg">
        <div className="relative mx-auto max-w-6xl px-6 pb-8 pt-20 text-center sm:pt-28">
          <motion.h1
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="display-heading mx-auto max-w-4xl text-4xl text-fg sm:text-6xl"
          >
            Point at the endpoint.
            <br />
            Walk away with its track record.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={0.1}
            className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-fg-secondary"
          >
            A seller bonds GEN behind their own advertised spec. GenLayer independently audits the
            live endpoint, on a schedule anyone can trigger — and a sustained streak of confirmed
            violations slashes the bond for the buyers who were relying on it.
          </motion.p>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={0.18}
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
          >
            <Button size="lg" asChild>
              <Link href="/create">
                Post a covenant <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/covenants">Browse covenants</Link>
            </Button>
          </motion.div>
        </div>

        {/* --------------------------------------------- Split before/after */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={0.28}
          className="relative mx-auto mt-14 max-w-6xl px-6 pb-24"
        >
          <div className="relative overflow-hidden rounded-[40px]">
            <div className="hero-drum absolute inset-0" />
            <div className="relative grid gap-6 p-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:p-10">
              <div className="card-input p-6">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-red" /> What you post
                </p>
                <p className="mt-3 text-lg font-semibold text-fg">A covenant</p>
                <div className="mt-4 flex flex-col gap-2.5">
                  {[
                    ["🛰️", "billing-api.example.com/health"],
                    ["📋", "99.9% uptime, <200ms p95"],
                    ["💰", "3,000 GEN bond"],
                    ["⛓️", "Slash: 1,000 GEN per breach"],
                  ].map(([icon, label]) => (
                    <div key={label} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[var(--shadow-soft)]">
                      <span className="text-base">{icon}</span>
                      <span className="text-sm text-fg-secondary">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fg text-bg sm:flex">
                <ArrowRight className="h-5 w-5" />
              </div>

              <div className="rounded-3xl border border-border bg-surface p-6 shadow-[var(--shadow-lifted)]">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" /> What you get
                </p>
                <p className="mt-3 text-lg font-semibold text-fg">A live truth-bond</p>
                <div className="mt-4 flex flex-col gap-2.5">
                  {[
                    ["Latest audit", "Compliant · 92% confidence"],
                    ["Streak", "0 consecutive violations"],
                    ["Breaches", "0 · bond fully intact"],
                    ["Beneficiaries", "14 registered"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between rounded-2xl border border-border bg-bg-subtle px-4 py-3">
                      <span className="text-xs font-medium text-fg-muted">{label}</span>
                      <span className="flex items-center gap-1 text-sm font-medium text-fg">
                        <ShieldCheck className="h-3.5 w-3.5 text-positive" /> {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Floating stat card */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="relative z-10 mx-auto -mt-12 w-full max-w-sm rounded-3xl border border-border bg-surface p-6 shadow-[var(--shadow-lifted)] sm:mx-6"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red text-white">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-semibold text-fg">Sentinel</span>
            </div>
            <div className="mt-4 flex items-end gap-4">
              <p className="text-5xl font-bold tracking-tight text-fg">92%</p>
              <div className="flex -space-x-2 pb-1.5">
                {["#E14A35", "#1E8A5F", "#3E6BF2", "#B8790A"].map((c) => (
                  <span
                    key={c}
                    className="h-7 w-7 rounded-full border-2 border-surface"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
              Independently re-derived by every validator — never a seller&apos;s self-report.
            </p>
            <p className="mt-3 text-sm font-semibold text-fg">Verified by consensus, continuously</p>
          </motion.div>
        </motion.div>
      </section>

      {/* ------------------------------------------------- Live stats strip */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <LiveStats />
        </div>
      </section>

      {/* ------------------------------------------------------ How it works */}
      <section className="border-t border-border bg-bg-subtle">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end"
          >
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-red">How it works</p>
              <h2 className="display-heading mt-3 max-w-lg text-3xl text-fg sm:text-4xl">
                Four steps from claim to verified.
              </h2>
            </div>
          </motion.div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="card-surface card-surface-hover p-6"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-soft text-red">
                  <step.icon className="h-5 w-5" />
                </div>
                <p className="mt-4 text-xs font-semibold text-fg-muted">STEP {i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold text-fg">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{step.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Who it's for */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="max-w-xl"
          >
            <p className="text-sm font-semibold uppercase tracking-wider text-red">Built for the agent economy</p>
            <h2 className="display-heading mt-3 text-3xl text-fg sm:text-4xl">
              Wherever a service makes a claim it should have to keep.
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {AUDIENCES.map((a, i) => (
              <motion.div
                key={a.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-3xl border border-border bg-bg-subtle p-7"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-red shadow-[var(--shadow-soft)]">
                  <a.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-fg">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{a.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Agent teaser */}
      <section className="border-t border-border bg-bg-subtle">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-center">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-sm font-semibold uppercase tracking-wider text-red">For agents & protocols</p>
            <h2 className="display-heading mt-3 text-3xl text-fg sm:text-4xl">
              Read a seller&apos;s track record. Decide before you pay.
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-fg-secondary">
              Every covenant exposes a single, cheap view call: current bond, breach history, and
              the latest independently-verified audit. No API keys, no oracle middleman — a direct
              read against a GenLayer contract, before an agent ever sends payment.
            </p>
            <Button className="mt-6" variant="outline" asChild>
              <Link href="/agents">
                View Agent SDK docs <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="overflow-hidden rounded-3xl border border-border-strong bg-code shadow-[var(--shadow-lifted)]"
          >
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-negative/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#e8b84a]/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-positive/70" />
              <span className="ml-2 flex items-center gap-1.5 text-xs text-white/50">
                <Code2 className="h-3 w-3" /> check-before-pay.ts
              </span>
            </div>
            <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-white/90">
              <code>{`import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const client = createClient({ chain: testnetBradbury });

const info = await client.readContract({
  address: COVENANT_ADDRESS,
  functionName: "get_covenant_info",
  args: [],
});

// { status, bond, consecutive_failures,
//   total_breaches, audit_count, ... }
if (info.status === "active" && info.total_breaches === "0") {
  console.log("Seller has a clean record -- safe to pay.");
}`}</code>
            </pre>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Final CTA */}
      <section className="relative overflow-hidden border-t border-border bg-bg">
        <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="display-heading text-3xl text-fg sm:text-4xl">
            Something is making a claim right now that deserves a bond.
          </h2>
          <p className="mt-4 text-fg-secondary">Post a covenant in a few minutes — no code required.</p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" asChild>
              <Link href="/create">
                Post a covenant <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/covenants">Browse existing covenants</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
