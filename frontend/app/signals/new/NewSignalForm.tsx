"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionPanel } from "@/components/TransactionPanel";
import { useGenLayerClient } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { useSignalWriteGate } from "@/lib/useSignalWriteGate";
import { createAuditSignal } from "@/lib/sentinel-calls";
import { parseGenToWei } from "@/lib/utils";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function defaultExpiry(): string {
  const date = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function NewSignalForm({ initialCovenant }: { initialCovenant: string }) {
  const router = useRouter();
  const { client } = useGenLayerClient();
  const [covenant, setCovenant] = useState(initialCovenant);
  const gate = useSignalWriteGate(ADDRESS_RE.test(covenant) ? (covenant as `0x${string}`) : undefined);
  const lifecycle = useTransactionLifecycle(client);

  const [label, setLabel] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [rule, setRule] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [reward, setReward] = useState("0.1");
  const [stipend, setStipend] = useState("0.01");
  const [pool, setPool] = useState("5");
  const [expires, setExpires] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setExpires(defaultExpiry());
  }, []);

  useEffect(() => {
    if (lifecycle.state.phase === "success") {
      router.push(`/covenants/${covenant}/signals`);
    }
  }, [lifecycle.state.phase, router, covenant]);

  const busy = lifecycle.state.phase === "submitting" || lifecycle.state.phase === "polling";

  const handleSubmit = () => {
    setValidationError(null);
    if (!ADDRESS_RE.test(covenant)) {
      setValidationError("Enter the covenant address this signal belongs to.");
      return;
    }
    let rewardWei: bigint;
    let stipendWei: bigint;
    let poolWei: bigint;
    try {
      rewardWei = parseGenToWei(reward);
      stipendWei = parseGenToWei(stipend);
      poolWei = parseGenToWei(pool);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Invalid GEN amount.");
      return;
    }
    if (rewardWei <= 0n) {
      setValidationError("Reward per hit must be greater than zero.");
      return;
    }
    if (stipendWei > rewardWei) {
      setValidationError("Stipend cannot exceed the hit reward.");
      return;
    }
    if (poolWei < rewardWei) {
      setValidationError("Initial pool must cover at least one hit reward.");
      return;
    }
    const intervalSeconds = Math.round(Number(intervalMinutes) * 60);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 60) {
      setValidationError("Poll interval must be at least 1 minute.");
      return;
    }
    const expiresAt = Math.floor(new Date(expires).getTime() / 1000);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000) {
      setValidationError("Expiry must be in the future.");
      return;
    }

    lifecycle.run(
      () =>
        createAuditSignal(
          client!,
          covenant as `0x${string}`,
          {
            label,
            endpointUrl,
            rule,
            intervalSeconds,
            rewardPerHit: rewardWei,
            stipend: stipendWei,
            expiresAt,
          },
          poolWei
        ),
      { requireAgree: true }
    );
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href={covenant ? `/covenants/${covenant}/signals` : "/covenants"}
        className="inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="display-heading mt-4 flex items-center gap-2 text-3xl text-fg">
        <Activity className="h-7 w-7 text-red" /> Fund a continuous signal
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        A signal is a pool plus one observable rule. Anyone may poll it once per interval; a hit pays the
        caller from the pool, and a miss or inconclusive poll pays only the stipend. There is no separate
        claim step, so a poll can never be paid twice.
      </p>

      {lifecycle.state.phase !== "idle" ? (
        <div className="mt-8">
          <TransactionPanel state={lifecycle.state} onReset={lifecycle.reset} successLabel="Signal funded" />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          <Field label="Covenant address">
            <Input
              value={covenant}
              onChange={(event) => setCovenant(event.target.value.trim())}
              placeholder="0x..."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Signal label">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Degraded status page"
              />
            </Field>
            <Field label="Poll interval (minutes)">
              <Input
                inputMode="numeric"
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Watched endpoint URL">
            <Input
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder="https://example.com/status"
            />
          </Field>

          <Field label="Watch rule (the condition a hit detects)">
            <textarea
              className="min-h-24 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-fg placeholder:text-fg-muted focus-visible:border-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red/20"
              value={rule}
              onChange={(event) => setRule(event.target.value)}
              placeholder="The response body reports a degraded, failing, or error state."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Reward per hit (GEN)">
              <Input inputMode="decimal" value={reward} onChange={(event) => setReward(event.target.value)} />
            </Field>
            <Field label="Stipend per non-hit (GEN)">
              <Input inputMode="decimal" value={stipend} onChange={(event) => setStipend(event.target.value)} />
            </Field>
            <Field label="Initial pool (GEN)">
              <Input inputMode="decimal" value={pool} onChange={(event) => setPool(event.target.value)} />
            </Field>
          </div>

          <Field label="Expires at">
            <Input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} />
          </Field>

          {!gate.ready && <p className="text-xs text-warning">{gate.reason}</p>}
          {validationError && <p className="text-xs text-negative">{validationError}</p>}

          <Button onClick={handleSubmit} disabled={!gate.ready || busy}>
            {busy ? "Submitting..." : "Fund signal"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</span>
      {children}
    </label>
  );
}
