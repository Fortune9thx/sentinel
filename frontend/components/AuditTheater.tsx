"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Radar, ShieldAlert, ShieldCheck, HelpCircle, X, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsensusVisualizer } from "@/components/ConsensusVisualizer";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { useGenLayerClient, getReadOnlyClient } from "@/lib/genlayer-client";
import { runAudit, fetchAudits } from "@/lib/sentinel-calls";
import type { AuditRecord } from "@/lib/sentinel-abi";

type Stage = "preview" | "running" | "revealed";

export function AuditTheater({
  covenantAddress,
  endpointUrl,
  spec,
  onClose,
  onAudited,
}: {
  covenantAddress: `0x${string}`;
  endpointUrl: string;
  spec: string;
  onClose: () => void;
  onAudited: () => void;
}) {
  const { client } = useGenLayerClient();
  const { state, run } = useTransactionLifecycle(client);
  const [stage, setStage] = useState<Stage>("preview");
  const [outcome, setOutcome] = useState<AuditRecord | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const busy = state.phase === "submitting" || state.phase === "polling";

  async function handleRun() {
    setStage("running");
    await run(() => runAudit(client!, covenantAddress), { requireFinalized: true });
  }

  async function revealResult() {
    try {
      const audits = await fetchAudits(getReadOnlyClient(), covenantAddress);
      const latest = audits[audits.length - 1] ?? null;
      setOutcome(latest);
      setStage("revealed");
      onAudited();
    } catch (err) {
      setResultError(err instanceof Error ? err.message : "Couldn't load the result.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border-strong bg-surface shadow-[var(--shadow-lifted)]"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-red" />
            <p className="text-sm font-semibold text-fg">Audit</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-bg-subtle hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-8">
          <AnimatePresence mode="wait">
            {stage === "preview" && (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Live endpoint to fetch</p>
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-bg-subtle px-4 py-2.5 text-sm">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                    <span className="truncate font-mono text-xs text-fg-secondary">{endpointUrl}</span>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Judged against</p>
                  <p className="mt-3 rounded-xl border border-border px-4 py-3 text-sm text-fg">{spec}</p>
                </div>

                <p className="text-xs leading-relaxed text-fg-muted">
                  Validators independently fetch this endpoint and judge compliance under GenLayer&rsquo;s
                  Equivalence Principle — never trusting the seller&rsquo;s own dashboard. A single bad audit
                  changes nothing; only a sustained streak of confirmed violations slashes the bond.
                </p>

                <Button onClick={handleRun} size="lg" disabled={!client || busy}>
                  {client ? "Run audit" : "Connect a wallet to audit"}
                </Button>
              </motion.div>
            )}

            {stage === "running" && (
              <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6 py-4">
                {state.phase === "submitting" && (
                  <div className="flex flex-col items-center gap-3 py-10 text-fg-secondary">
                    <Loader2 className="h-6 w-6 animate-spin text-red" />
                    <p className="text-sm">Waiting for wallet signature…</p>
                  </div>
                )}
                {state.phase === "polling" && state.status && (
                  <ConsensusVisualizer status={state.status} transaction={state.transaction} />
                )}
                {state.phase === "success" && (
                  <div className="flex flex-col items-center gap-4 py-6">
                    <ShieldCheck className="h-8 w-8 text-red" />
                    <p className="text-sm font-medium text-fg">Consensus reached — finalized on-chain</p>
                    <Button onClick={revealResult}>
                      Reveal the outcome <ArrowRight className="h-4 w-4" />
                    </Button>
                    {resultError && <p className="text-xs text-negative">{resultError}</p>}
                  </div>
                )}
                {state.phase === "error" && (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <p className="text-sm font-medium text-negative">{state.error}</p>
                    <Button variant="secondary" onClick={() => setStage("preview")}>
                      Back
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {stage === "revealed" && outcome && (outcome.outcome === "unreachable" || outcome.outcome === "inconclusive") && (
              <motion.div key="inconclusive" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning">
                    <HelpCircle className="h-6 w-6" />
                  </span>
                  <p className="text-lg font-semibold text-fg">
                    {outcome.outcome === "unreachable" ? "Endpoint unreachable" : "Inconclusive"}
                  </p>
                  <p className="max-w-sm text-sm text-fg-secondary">{outcome.reasoning}</p>
                </div>
                <div className="rounded-2xl border border-border bg-bg-subtle p-4 text-center text-sm text-fg-secondary">
                  Nothing moves on this outcome — no streak change, no bond touched. Fully retriable.
                </div>
                <Button onClick={onClose}>Done</Button>
              </motion.div>
            )}

            {stage === "revealed" && outcome && (outcome.outcome === "compliant" || outcome.outcome === "violation" || outcome.outcome === "unreachable_escalated") && (
              <motion.div key="revealed" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-2 text-center">
                  <span
                    className={
                      outcome.outcome === "compliant"
                        ? "flex h-12 w-12 items-center justify-center rounded-full bg-positive-soft text-positive"
                        : "flex h-12 w-12 items-center justify-center rounded-full bg-negative-soft text-negative"
                    }
                  >
                    {outcome.outcome === "compliant" ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
                  </span>
                  <p className="text-lg font-semibold text-fg">
                    {outcome.outcome === "compliant" ? "Compliant" : "Violation confirmed"}
                  </p>
                  <p className="text-xs text-fg-muted">Confidence: {(parseFloat(outcome.confidence) * 100).toFixed(0)}%</p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Reasoning</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary">{outcome.reasoning}</p>
                </div>

                {outcome.evidence_snapshot && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Real fetched evidence</p>
                    <pre className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-code p-3 font-mono text-[11px] leading-relaxed text-white/85">
                      {outcome.evidence_snapshot}
                    </pre>
                  </div>
                )}

                {outcome.breach_id && (
                  <div className="rounded-2xl border border-negative/30 bg-negative-soft p-4 text-center text-sm text-negative">
                    Three consecutive confirmed violations — this audit triggered a breach. See the Breaches tab.
                  </div>
                )}

                <Button onClick={onClose}>Done</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
