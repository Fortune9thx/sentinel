"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { TransactionPanel } from "@/components/TransactionPanel";
import { getReadOnlyClient, readContractRetry, useGenLayerClient } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { useSignalWriteGate } from "@/lib/useSignalWriteGate";
import {
  cancelSignal,
  claimSignalRefund,
  fetchCovenantInfo,
  fetchSignalRefund,
  fetchSignals,
  pauseSignal,
  pollSignal,
  resumeSignal,
  topUpSignal,
} from "@/lib/sentinel-calls";
import type { CovenantInfo } from "@/lib/sentinel-abi";
import type { SignalRecord } from "@/lib/signal-types";
import { formatGen, parseGenToWei, shortenAddress, timeAgo } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "positive" | "neutral" | "warning" | "negative"> = {
  active: "positive",
  paused: "warning",
  exhausted: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

export default function CovenantSignalsPage() {
  const params = useParams();
  const covenantAddress = params.address as `0x${string}`;
  const { client, address: myAddress } = useGenLayerClient();
  const gate = useSignalWriteGate(covenantAddress);
  const lifecycle = useTransactionLifecycle(client);

  const [info, setInfo] = useState<CovenantInfo | null>(null);
  const [signals, setSignals] = useState<SignalRecord[] | null>(null);
  const [refundable, setRefundable] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!covenantAddress) return;
    const read = getReadOnlyClient();
    setError(null);
    readContractRetry(() => fetchCovenantInfo(read, covenantAddress))
      .then(async (covenant) => {
        setInfo(covenant);
        const list = await readContractRetry(() => fetchSignals(read, covenantAddress));
        setSignals(list.slice().reverse());
        if (myAddress) {
          setRefundable(await fetchSignalRefund(read, covenantAddress, myAddress));
        } else {
          setRefundable("0");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load signals."));
  }, [covenantAddress, myAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = async (label: string, submit: () => Promise<`0x${string}`>) => {
    setAction(label);
    await lifecycle.run(submit, { requireAgree: true });
    refresh();
  };

  const busy = lifecycle.state.phase === "submitting" || lifecycle.state.phase === "polling";

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState
          title="Couldn't load these signals"
          description={error}
          action={<Button onClick={refresh}>Retry</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <Link
        href={`/covenants/${covenantAddress}`}
        className="inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to covenant
      </Link>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="display-heading flex items-center gap-2 text-3xl text-fg sm:text-4xl">
            <Activity className="h-7 w-7 text-red" /> Continuous signals
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
            Funded, interval-gated watchers attached to{" "}
            <span className="font-medium text-fg">{info?.service_name ?? "this covenant"}</span>. Every
            successful poll pays the caller once, in that same transaction -- there is no separate claim.
          </p>
        </div>
        <Button asChild>
          <Link href={`/signals/new?covenant=${covenantAddress}`}>
            <Plus className="h-4 w-4" /> New signal
          </Link>
        </Button>
      </div>

      {!gate.ready && <p className="mt-4 text-xs text-warning">{gate.reason}</p>}

      {refundable !== "0" && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-bg-subtle p-4">
          <p className="text-sm text-fg-secondary">
            You have <span className="font-semibold text-fg">{formatGen(refundable)} GEN</span> in unclaimed
            signal refunds.
          </p>
          <Button
            size="sm"
            disabled={!gate.ready || busy}
            onClick={() => runAction("refund", () => claimSignalRefund(client!, covenantAddress))}
          >
            Claim refund
          </Button>
        </div>
      )}

      {lifecycle.state.phase !== "idle" && (
        <div className="mt-6">
          <TransactionPanel
            state={lifecycle.state}
            onReset={lifecycle.reset}
            successLabel={action ? `${action} confirmed` : "Confirmed"}
          />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4">
        {signals === null ? (
          <>
            <div className="skeleton h-40 rounded-3xl" />
            <div className="skeleton h-40 rounded-3xl" />
          </>
        ) : signals.length === 0 ? (
          <EmptyState
            title="No signals yet"
            description="Create one to fund a repeating, permissionless watcher on this covenant. Hit payouts reward the caller; non-hit polls still pay a small stipend."
            action={
              <Button asChild>
                <Link href={`/signals/new?covenant=${covenantAddress}`}>
                  <Plus className="h-4 w-4" /> Create the first signal
                </Link>
              </Button>
            }
          />
        ) : (
          signals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              covenantAddress={covenantAddress}
              myAddress={myAddress}
              gateReady={gate.ready}
              gateReason={gate.reason}
              busy={busy}
              onPoll={() => runAction("Poll", () => pollSignal(client!, covenantAddress, signal.id))}
              onPause={() => runAction("Pause", () => pauseSignal(client!, covenantAddress, signal.id))}
              onResume={() => runAction("Resume", () => resumeSignal(client!, covenantAddress, signal.id))}
              onCancel={() => runAction("Cancel", () => cancelSignal(client!, covenantAddress, signal.id))}
              onTopUp={(amount) =>
                runAction("Top up", () => topUpSignal(client!, covenantAddress, signal.id, amount))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function SignalCard({
  signal,
  covenantAddress,
  myAddress,
  gateReady,
  gateReason,
  busy,
  onPoll,
  onPause,
  onResume,
  onCancel,
  onTopUp,
}: {
  signal: SignalRecord;
  covenantAddress: string;
  myAddress?: string;
  gateReady: boolean;
  gateReason: string | null;
  busy: boolean;
  onPoll: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onTopUp: (amount: bigint) => void;
}) {
  const [topUpAmount, setTopUpAmount] = useState("1");
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const isCreator = Boolean(myAddress && myAddress.toLowerCase() === signal.creator.toLowerCase());
  const closed = ["cancelled", "expired"].includes(signal.status);
  const detailHref = `/signals/${signal.id}?covenant=${covenantAddress}`;

  const handleTopUp = () => {
    setTopUpError(null);
    try {
      const wei = parseGenToWei(topUpAmount);
      if (wei <= 0n) throw new Error("Amount must be greater than zero.");
      onTopUp(wei);
    } catch (err) {
      setTopUpError(err instanceof Error ? err.message : "Invalid amount.");
    }
  };

  return (
    <div className="card-surface p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[signal.status] ?? "neutral"} className="capitalize">
              {signal.status}
            </Badge>
            <Badge variant="outline">Signal #{signal.id}</Badge>
            {signal.last_outcome && (
              <Badge variant={signal.last_outcome === "hit" ? "negative" : "neutral"}>
                Last: {signal.last_outcome}
              </Badge>
            )}
          </div>
          <Link href={detailHref} className="mt-2 block text-lg font-semibold text-fg hover:text-red">
            {signal.label}
          </Link>
          <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">{signal.rule}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-fg-muted">{signal.endpoint_url}</p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" asChild variant="outline">
            <Link href={detailHref}>Polls</Link>
          </Button>
          {!closed && (
            <Button size="sm" disabled={!gateReady || busy} onClick={onPoll} title={gateReason ?? undefined}>
              <RefreshCw className="h-3.5 w-3.5" /> Poll
            </Button>
          )}
          {isCreator && signal.status === "active" && (
            <Button size="sm" variant="secondary" disabled={!gateReady || busy} onClick={onPause}>
              Pause
            </Button>
          )}
          {isCreator && signal.status === "paused" && (
            <Button size="sm" variant="secondary" disabled={!gateReady || busy} onClick={onResume}>
              Resume
            </Button>
          )}
          {isCreator && !closed && (
            <Button size="sm" variant="danger" disabled={!gateReady || busy} onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Pool remaining" value={`${formatGen(signal.pool_remaining)} GEN`} />
        <Stat label="Paid out" value={`${formatGen(signal.total_paid)} GEN`} />
        <Stat label="Reward / stipend" value={`${formatGen(signal.reward_per_hit)} / ${formatGen(signal.stipend)}`} />
        <Stat label="Polls" value={signal.poll_count} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
        <span>Every {Number(signal.interval_seconds) / 60} min</span>
        <span>{signal.hit_count} hits</span>
        <span>{signal.miss_count} misses</span>
        <span>{signal.inconclusive_count} inconclusive</span>
        <span>Last poll {signal.last_poll_at === "0" ? "never" : timeAgo(signal.last_poll_at)}</span>
        <span>Creator {shortenAddress(signal.creator)}</span>
      </div>

      {isCreator && !closed && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="w-36">
            <label className="mb-1 block text-[11px] font-medium text-fg-muted">Top up (GEN)</label>
            <Input
              className="h-9"
              inputMode="decimal"
              value={topUpAmount}
              onChange={(event) => setTopUpAmount(event.target.value)}
            />
          </div>
          <Button size="sm" variant="secondary" disabled={!gateReady || busy} onClick={handleTopUp}>
            Add to pool
          </Button>
          {topUpError && <p className="w-full text-xs text-negative">{topUpError}</p>}
        </div>
      )}
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
