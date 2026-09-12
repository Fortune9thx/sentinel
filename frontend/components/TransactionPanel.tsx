"use client";

import { motion } from "framer-motion";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { ConsensusVisualizer } from "./ConsensusVisualizer";
import { Button } from "./ui/button";
import type { TransactionLifecycleState } from "@/lib/useTransactionLifecycle";
import { SENTINEL_ACTIVE_NETWORK } from "@/lib/contracts";

// genlayer-js's studioDevnet chain has no blockExplorers entry at all (it's a
// preview/RC network with no public explorer as of this writing) -- linking
// tx hashes to Bradbury's explorer here would be actively misleading, since a
// studioDev tx hash doesn't exist on Bradbury's chain. Only Bradbury gets a
// real link; every other active network shows the hash as plain text.
const EXPLORER_BASE = SENTINEL_ACTIVE_NETWORK === "bradbury" ? "https://explorer-bradbury.genlayer.com/" : null;

export function TransactionPanel({
  state,
  onReset,
  successLabel = "Confirmed on-chain",
}: {
  state: TransactionLifecycleState;
  onReset?: () => void;
  successLabel?: string;
}) {
  if (state.phase === "idle") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-surface flex flex-col items-center gap-4 p-6"
    >
      {state.phase === "submitting" && (
        <div className="flex flex-col items-center gap-3 py-6 text-fg-secondary">
          <Loader2 className="h-6 w-6 animate-spin text-red" />
          <p className="text-sm">Waiting for wallet signature…</p>
        </div>
      )}

      {state.phase === "polling" && state.status && (
        <ConsensusVisualizer status={state.status} transaction={state.transaction} />
      )}

      {state.phase === "success" && (
        <div className="flex flex-col items-center gap-2 py-4">
          <CheckCircle2 className="h-8 w-8 text-positive" />
          <p className="text-sm font-medium text-fg">{successLabel}</p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <XCircle className="h-8 w-8 text-negative" />
          <p className="text-sm font-medium text-negative">{state.error ?? "Something went wrong."}</p>
        </div>
      )}

      {state.hash && EXPLORER_BASE && (
        <a
          href={`${EXPLORER_BASE}tx/${state.hash}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-fg-muted underline decoration-dotted underline-offset-4 hover:text-red"
        >
          {state.hash.slice(0, 10)}…{state.hash.slice(-8)}
        </a>
      )}
      {state.hash && !EXPLORER_BASE && (
        <p className="font-mono text-xs text-fg-muted">
          {state.hash.slice(0, 10)}…{state.hash.slice(-8)}
        </p>
      )}

      {(state.phase === "success" || state.phase === "error") && onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Done
        </Button>
      )}
    </motion.div>
  );
}
