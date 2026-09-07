"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { TransactionPanel } from "@/components/TransactionPanel";
import { useGenLayerClient, getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { createCovenant, fetchCovenants, fetchCreationStake, waitForNewCovenant } from "@/lib/sentinel-calls";
import { getSentinelFactoryAddress, isSentinelFactoryDeployed } from "@/lib/contracts";
import { cn, formatGen, parseGenToWei } from "@/lib/utils";

const STEP_LABELS = ["Service", "Spec & bond", "Review & post"];

export default function CreateCovenantPage() {
  const router = useRouter();
  const { client } = useGenLayerClient();
  const { state, run, reset } = useTransactionLifecycle(client);

  const [step, setStep] = useState(0);
  const [serviceName, setServiceName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [spec, setSpec] = useState("");
  const [slashAmount, setSlashAmount] = useState("");
  const [minBond, setMinBond] = useState("");
  const [creationStake, setCreationStake] = useState<string | null>(null);
  const [creationStakeError, setCreationStakeError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const factoryAddress = getSentinelFactoryAddress();

  function loadCreationStake() {
    if (!factoryAddress) return;
    setCreationStakeError(null);
    // Retried: this value is never cosmetic -- it's the exact `value` sent
    // with create_covenant. A silent fallback to "0" here would both
    // mislead the Review step AND submit a real transaction with 0 GEN
    // attached, which the contract then correctly rejects for insufficient
    // stake -- a confusing failure with no visible cause. Never guess this
    // value; show a real error instead.
    readContractRetry(() => fetchCreationStake(getReadOnlyClient(), factoryAddress))
      .then(setCreationStake)
      .catch(() => setCreationStakeError("Couldn't load the creation stake from the network."));
  }

  useEffect(() => {
    loadCreationStake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryAddress]);

  if (!isSentinelFactoryDeployed() || !factoryAddress) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState
          title="SentinelFactory not deployed yet"
          description="This deployment of the app isn't pointed at a live SentinelFactory contract yet, so new covenants can't be posted here. Check back once the contract is live."
        />
      </div>
    );
  }

  let slashWei: bigint | null = null;
  let minBondWei: bigint | null = null;
  try {
    if (slashAmount.trim()) slashWei = parseGenToWei(slashAmount);
  } catch {
    /* validated in validateStep */
  }
  try {
    if (minBond.trim()) minBondWei = parseGenToWei(minBond);
  } catch {
    /* validated in validateStep */
  }

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (!serviceName.trim()) return "Give the service a name.";
      if (!/^https?:\/\//i.test(endpointUrl.trim())) return "endpoint_url must start with http:// or https://";
    }
    if (current === 1) {
      if (!spec.trim()) return "Describe the spec this covenant is bonded against.";
      if (!slashAmount.trim() || slashWei === null || slashWei <= 0n) return "Enter a valid slash amount, e.g. 1000.";
      if (!minBond.trim() || minBondWei === null || minBondWei <= 0n) return "Enter a valid minimum bond, e.g. 3000.";
      if (minBondWei < slashWei) return "Minimum bond must be at least the slash amount -- a covenant must be able to absorb at least one breach.";
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    // creationStake being unknown (still loading, or the retried fetch
    // ultimately failed) must block submission rather than silently send a
    // wrong `value` -- see loadCreationStake()'s comment.
    if (!client || !factoryAddress || creationStake === null || slashWei === null || minBondWei === null) return;
    const stakeWei = BigInt(creationStake);
    // Fired in parallel with run() below, NOT awaited first -- this read is
    // only needed after the write succeeds (to resolve the new covenant's
    // address), so blocking the wallet-signature prompt on it first would
    // be a real UX bug: a slow/flaky read would visibly delay the wallet
    // popup even though the two are logically independent until the write
    // actually finishes.
    const beforeCovenantsPromise = fetchCovenants(getReadOnlyClient(), factoryAddress).catch(() => []);
    // A new covenant address is exactly the kind of output other things act
    // on (the Explorer lists it, this page navigates straight to it, a
    // beneficiary immediately registers standing against it) -- ACCEPTED
    // can still be appealed and reversed before FINALIZED, so this is one
    // of the writes that must wait for the stronger guarantee.
    await run(
      () => createCovenant(client, factoryAddress, serviceName.trim(), endpointUrl.trim(), spec.trim(), slashWei!, minBondWei!, stakeWei),
      { requireFinalized: true }
    );
    setResolving(true);
    try {
      const beforeCovenants = await beforeCovenantsPromise;
      const newAddress = await waitForNewCovenant(getReadOnlyClient(), factoryAddress, beforeCovenants.length);
      setResolvedAddress(newAddress);
    } catch {
      // Non-fatal: the covenant was almost certainly created (tx succeeded)
      // -- just couldn't confirm the exact address to auto-redirect to yet.
    } finally {
      setResolving(false);
    }
  }

  const busy = state.phase === "submitting" || state.phase === "polling";

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wider text-red">Post a covenant</p>
      <h1 className="display-heading mt-2 text-3xl text-fg sm:text-4xl">Bond your spec to real GEN</h1>

      {state.phase === "idle" && (
        <div className="mt-8 flex items-center gap-2">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  i < step
                    ? "bg-red text-white"
                    : i === step
                    ? "border-2 border-red text-red"
                    : "border border-border text-fg-muted"
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={cn("hidden text-sm sm:block", i === step ? "text-fg font-medium" : "text-fg-muted")}>
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        {state.phase !== "idle" ? (
          <div className="flex flex-col items-center gap-6">
            <TransactionPanel state={state} successLabel="Covenant is live" />
            {state.phase === "success" && (
              <div className="flex flex-col items-center gap-3">
                {resolving && <p className="text-sm text-fg-secondary">Resolving your new covenant address…</p>}
                {resolvedAddress ? (
                  <Button onClick={() => router.push(`/covenants/${resolvedAddress}`)}>
                    View your covenant <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  !resolving && (
                    <Button variant="secondary" onClick={() => router.push("/covenants")}>
                      Go to Explorer
                    </Button>
                  )
                )}
              </div>
            )}
            {state.phase === "error" && (
              <Button
                variant="secondary"
                onClick={() => {
                  reset();
                  setResolvedAddress(null);
                }}
              >
                Try again
              </Button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              {step === 0 && (
                <div className="card-surface p-6">
                  <h2 className="text-lg font-semibold text-fg">What service is this covenant watching?</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    The endpoint below is fetched fresh, live, every time anyone triggers an audit. It must be a
                    real, reachable http(s) URL — validators judge exactly what it returns at audit time.
                  </p>
                  <div className="mt-5 flex flex-col gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Service name</label>
                      <Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Billing API" maxLength={140} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Endpoint URL</label>
                      <Input value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://billing-api.example.com/health" />
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="card-surface p-6">
                  <h2 className="text-lg font-semibold text-fg">Spec, bond, and slash</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    A single bad audit never slashes anything — only three consecutive confirmed violations do.
                    Set an initial minimum bond your covenant must reach before it activates.
                  </p>
                  <div className="mt-5 flex flex-col gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Advertised spec</label>
                      <Textarea
                        value={spec}
                        onChange={(e) => setSpec(e.target.value)}
                        placeholder="99.9% uptime, sub-200ms p95 latency, JSON responses only."
                        maxLength={1500}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Slash per breach (GEN)</label>
                        <Input value={slashAmount} onChange={(e) => setSlashAmount(e.target.value)} placeholder="1000" inputMode="decimal" />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Minimum bond (GEN)</label>
                        <Input value={minBond} onChange={(e) => setMinBond(e.target.value)} placeholder="3000" inputMode="decimal" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="card-surface p-6">
                  <h2 className="text-lg font-semibold text-fg">Review</h2>
                  <dl className="mt-5 flex flex-col gap-4 text-sm">
                    <div>
                      <dt className="text-fg-muted">Service</dt>
                      <dd className="mt-1 text-fg">{serviceName}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Endpoint</dt>
                      <dd className="mt-1 truncate font-mono text-xs text-fg">{endpointUrl}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Spec</dt>
                      <dd className="mt-1 text-fg-secondary">{spec}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <dt className="text-fg-muted">Slash per breach</dt>
                        <dd className="mt-1 text-fg">{slashAmount || "—"} GEN</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Minimum bond</dt>
                        <dd className="mt-1 text-fg">{minBond || "—"} GEN</dd>
                      </div>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Creation stake</dt>
                      <dd className="mt-1 font-semibold text-fg">
                        {creationStakeError ? (
                          <span className="flex items-center gap-2 text-sm font-normal text-negative">
                            {creationStakeError}
                            <button onClick={loadCreationStake} className="font-medium text-red underline underline-offset-2">
                              Retry
                            </button>
                          </span>
                        ) : creationStake === null ? (
                          <span className="inline-block h-5 w-16 animate-pulse-soft rounded bg-bg-subtle align-middle" />
                        ) : (
                          `${formatGen(creationStake)} GEN`
                        )}
                      </dd>
                    </div>
                    <p className="text-xs text-fg-muted">
                      Posting deploys the covenant unfunded — you&apos;ll fund the bond in a separate step right
                      after, activating it automatically once it clears your minimum bond.
                    </p>
                  </dl>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {stepError && state.phase === "idle" && (
        <p className="mt-4 text-sm text-negative">{stepError}</p>
      )}

      {state.phase === "idle" && (
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" onClick={goBack} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < STEP_LABELS.length - 1 ? (
            <Button onClick={goNext}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!client || busy || creationStake === null}>
              {!client
                ? "Connect a wallet to continue"
                : creationStake === null
                ? "Waiting for creation stake…"
                : "Post this covenant"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
