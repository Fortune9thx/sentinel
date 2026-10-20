"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Activity, ArrowUpRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { TransactionPanel } from "@/components/TransactionPanel";
import { getReadOnlyClient, readContractRetry, useGenLayerClient } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { useSignalWriteGate } from "@/lib/useSignalWriteGate";
import {
  cancelSignal,
  claimSignalRefund,
  fetchSignal,
  fetchSignalPolls,
  fetchSignalRefund,
  pauseSignal,
  pollSignal,
  resumeSignal,
} from "@/lib/sentinel-calls";
import type { SignalPoll, SignalRecord } from "@/lib/signal-types";
import { formatGen, shortenAddress, timeAgo } from "@/lib/utils";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const STATUS_VARIANT: Record<string, "positive" | "neutral" | "warning" | "negative"> = {
  active: "positive",
  paused: "warning",
  exhausted: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

export function SignalDetail({
  covenantAddress,
  signalId,
}: {
  covenantAddress: string;
  signalId: string;
}) {
  const validAddress = ADDRESS_RE.test(covenantAddress) ? (covenantAddress as `0x${string}`) : undefined;
  const { client, address: myAddress } = useGenLayerClient();
  const gate = useSignalWriteGate(validAddress);
  const lifecycle = useTransactionLifecycle(client);

  const [signal, setSignal] = useState<SignalRecord | null>(null);
  const [polls, setPolls] = useState<SignalPoll[] | null>(null);
  const [refundable, setRefundable] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("Confirmed");

  const refresh = useCallback(() => {
    if (!validAddress) {
      setError("This signal URL is missing its covenant address. Open it from the covenant's signals page.");
      return;
    }
    const read = getReadOnlyClient();
    readContractRetry(() => fetchSignal(read, validAddress, signalId))
      .then(async (record) => {
        setSignal(record);
        const list = await readContractRetry(() => fetchSignalPolls(read, validAddress, signalId));
        setPolls(list.slice().reverse());
        if (myAddress) {
          setRefundable(await fetchSignalRefund(read, validAddress, myAddress));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this signal."));
  }, [validAddress, signalId, myAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = async (label: string, submit: () => Promise<`0x${string}`>) => {
    setAction(label);
    await lifecycle.run(submit, { requireAgree: true });
    refresh();
  };

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState title="Couldn't load this signal" description={error} action={<Button onClick={refresh}>Retry</Button>} />
      </div>
    );
  }

  if (!signal || !validAddress) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="skeleton h-10 w-2/3 rounded-lg" />
        <div className="skeleton mt-4 h-32 w-full rounded-3xl" />
      </div>
    );
  }

  const isCreator = Boolean(myAddress && myAddress.toLowerCase() === signal.creator.toLowerCase());
  const closed = ["cancelled", "expired"].includes(signal.status);
  const busy = lifecycle.state.phase === "submitting" || lifecycle.state.phase === "polling";

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <Link
        href={`/covenants/${validAddress}/signals`}
        className="inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> All signals for this covenant
      </Link>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[signal.status] ?? "neutral"} className="capitalize">
              {signal.status}
            </Badge>
            <Badge variant="outline">Signal #{signal.id}</Badge>
            <Badge variant="neutral">
              <Activity className="h-3 w-3" /> {signal.poll_count} polls
            </Badge>
          </div>
          <h1 className="display-heading mt-3 text-3xl text-fg">{signal.label}</h1>
          <a
            href={signal.endpoint_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-fg-secondary hover:text-fg"
          >
            {signal.endpoint_url} <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {!closed && (
            <Button
              disabled={!gate.ready || busy}
              title={gate.reason ?? undefined}
              onClick={() => runAction("Poll", () => pollSignal(client!, validAddress, signal.id))}
            >
              <RefreshCw className="h-4 w-4" /> Poll now
            </Button>
          )}
          {isCreator && signal.status === "active" && (
            <Button
              variant="secondary"
              disabled={!gate.ready || busy}
              onClick={() => runAction("Pause", () => pauseSignal(client!, validAddress, signal.id))}
            >
              Pause
            </Button>
          )}
          {isCreator && signal.status === "paused" && (
            <Button
              variant="secondary"
              disabled={!gate.ready || busy}
              onClick={() => runAction("Resume", () => resumeSignal(client!, validAddress, signal.id))}
            >
              Resume
            </Button>
          )}
          {isCreator && !closed && (
            <Button
              variant="danger"
              disabled={!gate.ready || busy}
              onClick={() => runAction("Cancel", () => cancelSignal(client!, validAddress, signal.id))}
            >
              Cancel &amp; refund
            </Button>
          )}
        </div>
      </div>

      {!gate.ready && <p className="mt-3 text-xs text-warning">{gate.reason}</p>}

      <div className="mt-6 rounded-2xl border border-border bg-bg-subtle p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Watched rule</p>
        <p className="mt-1.5 text-sm text-fg-secondary">{signal.rule}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Pool remaining" value={`${formatGen(signal.pool_remaining)} GEN`} />
        <Stat label="Total paid" value={`${formatGen(signal.total_paid)} GEN`} />
        <Stat label="Hit reward" value={`${formatGen(signal.reward_per_hit)} GEN`} />
        <Stat label="Non-hit stipend" value={`${formatGen(signal.stipend)} GEN`} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
        <span>Every {Number(signal.interval_seconds) / 60} min</span>
        <span>{signal.hit_count} hits / {signal.miss_count} misses / {signal.inconclusive_count} inconclusive</span>
        <span>Consecutive hits {signal.consecutive_hits}</span>
        <span>Expires {new Date(Number(signal.expires_at) * 1000).toLocaleString()}</span>
        <span>Creator {shortenAddress(signal.creator)}</span>
      </div>

      {refundable !== "0" && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-fg-secondary">
            Refund owed to you: <span className="font-semibold text-fg">{formatGen(refundable)} GEN</span>
          </p>
          <Button
            size="sm"
            disabled={!gate.ready || busy}
            onClick={() => runAction("Refund", () => claimSignalRefund(client!, validAddress))}
          >
            Claim refund
          </Button>
        </div>
      )}

      {lifecycle.state.phase !== "idle" && (
        <div className="mt-5">
          <TransactionPanel state={lifecycle.state} onReset={lifecycle.reset} successLabel={`${action} confirmed`} />
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold text-fg">Poll history</h2>
      <p className="mt-1 text-xs text-fg-muted">
        Each poll pays at most once, inside the poll itself. A payout of 0 means the poll was recorded but
        the pool could not cover even the stipend at that moment.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {polls === null ? (
          <div className="skeleton h-28 rounded-2xl" />
        ) : polls.length === 0 ? (
          <EmptyState title="No polls yet" description="The first poll can be run by anyone once the interval has elapsed." />
        ) : (
          polls.map((poll) => (
            <div key={poll.id} className="card-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={poll.outcome === "hit" ? "negative" : poll.outcome === "miss" ? "positive" : "warning"}>
                    {poll.outcome}
                  </Badge>
                  <span className="text-xs text-fg-muted">Poll #{poll.id}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-fg-muted">
                  <span className="font-medium text-fg">{formatGen(poll.payout)} GEN paid</span>
                  <span>{timeAgo(poll.polled_at)}</span>
                </div>
              </div>
              <p className="mt-2 text-sm text-fg-secondary">{poll.reasoning || "No reasoning recorded."}</p>
              {poll.evidence_snapshot && (
                <pre className="mt-3 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl bg-code p-3 font-mono text-[11px] leading-relaxed text-white/85">
                  {poll.evidence_snapshot}
                </pre>
              )}
              <p className="mt-2 break-all font-mono text-[10px] text-fg-muted">
                fingerprint {poll.fingerprint || "unavailable"} · poller {shortenAddress(poll.poller)} · confidence{" "}
                {(parseFloat(poll.confidence || "0") * 100).toFixed(0)}%
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-subtle px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-fg">{value}</p>
    </div>
  );
}
