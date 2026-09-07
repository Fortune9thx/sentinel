"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Globe,
  ShieldCheck,
  ShieldAlert,
  Radar,
  Clock,
  Coins,
  Users,
  Gavel,
  History as HistoryIcon,
  LogOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { FundBondDialog } from "@/components/FundBondDialog";
import { AuditTheater } from "@/components/AuditTheater";
import { useGenLayerClient, getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { TransactionPanel } from "@/components/TransactionPanel";
import {
  fetchCovenantInfo,
  fetchAudits,
  fetchBreaches,
  fetchIsBeneficiary,
  fetchClaimable,
  fetchIsClaimed,
  registerAsBeneficiary,
  claimSlashShare,
  requestExit,
  withdrawRemainingBond,
} from "@/lib/sentinel-calls";
import { formatGen, shortenAddress, timeAgo } from "@/lib/utils";
import { EXIT_COOLDOWN_SECONDS } from "@/lib/sentinel-abi";
import type { CovenantInfo, AuditRecord, BreachRecord } from "@/lib/sentinel-abi";

const STATUS_VARIANT: Record<string, "positive" | "neutral" | "warning"> = {
  active: "positive",
  pending_bond: "warning",
  exiting: "warning",
  exited: "neutral",
};

const OUTCOME_META: Record<string, { label: string; variant: "positive" | "negative" | "warning" | "neutral"; icon: typeof ShieldCheck }> = {
  compliant: { label: "Compliant", variant: "positive", icon: ShieldCheck },
  violation: { label: "Violation", variant: "negative", icon: ShieldAlert },
  unreachable_escalated: { label: "Sustained outage", variant: "negative", icon: ShieldAlert },
  unreachable: { label: "Unreachable", variant: "warning", icon: Radar },
  inconclusive: { label: "Inconclusive", variant: "warning", icon: Radar },
};

export default function CovenantDetailPage() {
  const params = useParams();
  const address = params.address as `0x${string}`;
  const { client, address: myAddress } = useGenLayerClient();
  const claimLifecycle = useTransactionLifecycle(client);
  const beneficiaryLifecycle = useTransactionLifecycle(client);
  const exitLifecycle = useTransactionLifecycle(client);

  const [info, setInfo] = useState<CovenantInfo | null>(null);
  const [audits, setAudits] = useState<AuditRecord[] | null>(null);
  const [breaches, setBreaches] = useState<BreachRecord[] | null>(null);
  const [isBeneficiary, setIsBeneficiary] = useState(false);
  const [claimable, setClaimable] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const [fundOpen, setFundOpen] = useState(false);
  const [theaterOpen, setTheaterOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!address) return;
    setError(null);
    const client = getReadOnlyClient();
    // Retried, not single-shot: a covenant navigated to right after posting
    // is a real, expected case of a freshly deployed contract not being
    // readable for a few seconds yet -- a genuine "contract not found" on
    // first load, not a broken covenant.
    readContractRetry(() => fetchCovenantInfo(client, address))
      .then((i) => {
        setInfo(i);
        return Promise.all([
          readContractRetry(() => fetchAudits(client, address)),
          readContractRetry(() => fetchBreaches(client, address)),
          myAddress ? readContractRetry(() => fetchIsBeneficiary(client, address, myAddress)) : Promise.resolve(false),
        ]);
      })
      .then(([auditsRes, breachesRes, isBenRes]) => {
        setAudits(auditsRes.slice().reverse());
        setBreaches(breachesRes.slice().reverse());
        setIsBeneficiary(isBenRes);
        if (myAddress) {
          Promise.all(
            breachesRes.map(async (b) => {
              try {
                const amount = await fetchClaimable(client, address, b.id, myAddress);
                const claimed = await fetchIsClaimed(client, address, b.id, myAddress);
                return [b.id, claimed ? "0" : amount] as const;
              } catch {
                return [b.id, "0"] as const;
              }
            })
          ).then((entries) => setClaimable(Object.fromEntries(entries)));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this covenant."));
  }, [address, myAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState
          title="Couldn't load this covenant"
          description={`${error} If this covenant was just posted, it may still be propagating -- this can take a little longer than usual right now.`}
          action={<Button onClick={refresh}>Retry</Button>}
        />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="skeleton h-10 w-2/3 rounded-lg" />
        <div className="skeleton mt-4 h-24 w-full rounded-3xl" />
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="skeleton h-48 rounded-3xl" />
          <div className="skeleton h-48 rounded-3xl" />
        </div>
      </div>
    );
  }

  const isSeller = myAddress && myAddress.toLowerCase() === info.address_seller.toLowerCase();
  const canWithdraw =
    info.status === "exiting" &&
    Number(info.exit_requested_at) > 0 &&
    Date.now() / 1000 >= Number(info.exit_requested_at) + EXIT_COOLDOWN_SECONDS;

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[info.status] ?? "neutral"} className="capitalize">
              {info.status.replace("_", " ")}
            </Badge>
            <Badge variant="red">
              <Coins className="h-3 w-3" /> {formatGen(info.bond)} GEN bonded
            </Badge>
          </div>
          <h1 className="display-heading mt-3 text-3xl text-fg sm:text-4xl">{info.service_name}</h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-secondary">
            <Globe className="h-3.5 w-3.5" /> <span className="truncate font-mono text-xs">{info.endpoint_url}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setFundOpen(true)}>
            Fund bond
          </Button>
          {!isBeneficiary && (
            <Button
              variant="secondary"
              disabled={!client || beneficiaryLifecycle.state.phase === "submitting" || beneficiaryLifecycle.state.phase === "polling"}
              onClick={() => beneficiaryLifecycle.run(() => registerAsBeneficiary(client!, address)).then(refresh)}
            >
              <Users className="h-4 w-4" /> Register as beneficiary
            </Button>
          )}
          {info.status !== "exited" && (
            <Button onClick={() => setTheaterOpen(true)}>
              <Radar className="h-4 w-4" /> Run audit
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-muted">
        <span className="flex items-center gap-1.5">
          <Gavel className="h-4 w-4" /> {info.total_breaches} breach{info.total_breaches === "1" ? "" : "es"}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4" /> {info.consecutive_failures}/3 consecutive violations
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4" /> {info.beneficiary_count} beneficiaries
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" /> Posted {timeAgo(info.created_at)}
        </span>
        <span>By {shortenAddress(info.address_seller)}</span>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-bg-subtle p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Advertised spec</p>
        <p className="mt-1.5 text-sm text-fg-secondary">{info.spec}</p>
      </div>

      {isSeller && info.status !== "exited" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border-strong bg-surface p-4">
          <p className="text-sm text-fg-secondary">Seller controls:</p>
          {info.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              disabled={exitLifecycle.state.phase === "submitting" || exitLifecycle.state.phase === "polling"}
              onClick={() => exitLifecycle.run(() => requestExit(client!, address)).then(refresh)}
            >
              <LogOut className="h-3.5 w-3.5" /> Request exit
            </Button>
          )}
          {info.status === "exiting" && (
            <Button
              variant="outline"
              size="sm"
              disabled={!canWithdraw || exitLifecycle.state.phase === "submitting" || exitLifecycle.state.phase === "polling"}
              onClick={() => exitLifecycle.run(() => withdrawRemainingBond(client!, address)).then(refresh)}
            >
              {canWithdraw ? "Withdraw remaining bond" : `Withdrawable ${timeAgo(String(Number(info.exit_requested_at) + EXIT_COOLDOWN_SECONDS))}`}
            </Button>
          )}
          {exitLifecycle.state.phase !== "idle" && (
            <div className="w-full">
              <TransactionPanel state={exitLifecycle.state} onReset={exitLifecycle.reset} successLabel="Confirmed" />
            </div>
          )}
        </div>
      )}

      {beneficiaryLifecycle.state.phase !== "idle" && (
        <div className="mt-4">
          <TransactionPanel state={beneficiaryLifecycle.state} onReset={beneficiaryLifecycle.reset} successLabel="Registered" />
        </div>
      )}

      <div className="mt-10">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Latest audit</TabsTrigger>
            <TabsTrigger value="log">Audit log ({audits?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="breaches">Breaches ({breaches?.length ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {audits && audits.length > 0 ? (
              <AuditCard record={audits[0]} />
            ) : (
              <EmptyState
                title="No audits yet"
                description="Anyone can trigger the first audit — GenLayer will independently fetch the live endpoint and judge it against the spec."
                action={
                  <Button onClick={() => setTheaterOpen(true)}>
                    <Radar className="h-4 w-4" /> Run the first audit
                  </Button>
                }
              />
            )}
          </TabsContent>

          <TabsContent value="log">
            {audits && audits.length > 0 ? (
              <div className="flex flex-col gap-3">
                {audits.map((a) => (
                  <AuditCard key={a.id} record={a} compact />
                ))}
              </div>
            ) : (
              <EmptyState title="No audits yet" description="This covenant hasn't been audited yet." />
            )}
          </TabsContent>

          <TabsContent value="breaches">
            {breaches && breaches.length > 0 ? (
              <div className="flex flex-col gap-4">
                {breaches.map((b) => (
                  <motion.div key={b.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-surface flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-negative-soft text-negative">
                        <HistoryIcon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-fg">Breach #{b.id}</p>
                        <p className="text-xs text-fg-muted">
                          {formatGen(b.slash_amount)} GEN slashed · {b.eligible_count} eligible · {timeAgo(b.evaluated_at)}
                        </p>
                      </div>
                    </div>
                    {myAddress && Number(claimable[b.id] ?? "0") > 0 && (
                      <Button
                        size="sm"
                        disabled={claimLifecycle.state.phase === "submitting" || claimLifecycle.state.phase === "polling"}
                        onClick={() => claimLifecycle.run(() => claimSlashShare(client!, address, b.id)).then(refresh)}
                      >
                        Claim {formatGen(claimable[b.id])} GEN
                      </Button>
                    )}
                  </motion.div>
                ))}
                {claimLifecycle.state.phase !== "idle" && (
                  <TransactionPanel state={claimLifecycle.state} onReset={claimLifecycle.reset} successLabel="Claimed" />
                )}
              </div>
            ) : (
              <EmptyState title="No breaches" description="This covenant has a clean record — no confirmed breach yet." />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <FundBondDialog open={fundOpen} onOpenChange={setFundOpen} covenantAddress={address} onSuccess={refresh} />

      {theaterOpen && (
        <AuditTheater
          covenantAddress={address}
          endpointUrl={info.endpoint_url}
          spec={info.spec}
          onClose={() => setTheaterOpen(false)}
          onAudited={refresh}
        />
      )}
    </div>
  );
}

function AuditCard({ record, compact }: { record: AuditRecord; compact?: boolean }) {
  const meta = OUTCOME_META[record.outcome] ?? OUTCOME_META.inconclusive;
  const Icon = meta.icon;

  if (compact) {
    return (
      <div className="card-surface flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <Badge variant={meta.variant}>
            <Icon className="h-3 w-3" /> {meta.label}
          </Badge>
          <p className="line-clamp-1 text-sm text-fg-secondary">{record.reasoning}</p>
        </div>
        <span className="shrink-0 text-xs text-fg-muted">{timeAgo(record.evaluated_at)}</span>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-surface p-7">
      <div className="flex items-center gap-2">
        <Badge variant={meta.variant}>
          <Icon className="h-3.5 w-3.5" /> {meta.label}
        </Badge>
        <span className="text-xs text-fg-muted">{timeAgo(record.evaluated_at)}</span>
      </div>
      <p className="mt-4 text-base leading-relaxed text-fg">{record.reasoning}</p>
      {record.evidence_snapshot && (
        <div className="mt-5 border-t border-border pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Real fetched evidence</p>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-code p-3 font-mono text-[11px] leading-relaxed text-white/85">
            {record.evidence_snapshot}
          </pre>
        </div>
      )}
      <p className="mt-3 text-xs text-fg-muted">
        Confidence {(parseFloat(record.confidence || "0") * 100).toFixed(0)}%
        {record.breach_id && " · triggered a breach"}
      </p>
    </motion.div>
  );
}
