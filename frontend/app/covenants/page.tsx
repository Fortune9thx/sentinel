"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { CovenantCard } from "@/components/CovenantCard";
import { getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { fetchCovenants, fetchCovenantMeta } from "@/lib/sentinel-calls";
import { getSentinelFactoryAddress, isSentinelFactoryDeployed } from "@/lib/contracts";
import type { CovenantMeta } from "@/lib/sentinel-abi";

export default function CovenantsExplorerPage() {
  const [covenants, setCovenants] = useState<CovenantMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!isSentinelFactoryDeployed()) {
      setCovenants([]);
      return;
    }
    const address = getSentinelFactoryAddress()!;
    const client = getReadOnlyClient();
    let cancelled = false;
    setError(null);
    setCovenants(null);

    // Retried, not single-shot -- Bradbury's read path has real, confirmed
    // intermittent failures for genuinely valid contracts, independent of
    // this app's logic. Per-covenant metadata reads keep their existing
    // fail-soft "drop it from the list rather than block the page" filter,
    // but now with a retry pass first so a transient blip doesn't silently
    // hide a real covenant.
    readContractRetry(() => fetchCovenants(client, address))
      .then(async (addresses) => {
        const metas = await Promise.all(
          addresses.map((a) => readContractRetry(() => fetchCovenantMeta(client, address, a)).catch(() => null))
        );
        if (!cancelled) setCovenants(metas.filter((m): m is CovenantMeta => m !== null).reverse());
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load covenants.");
      });

    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const filtered = covenants
    ? covenants.filter(
        (c) =>
          !query ||
          c.service_name.toLowerCase().includes(query.toLowerCase()) ||
          c.endpoint_url.toLowerCase().includes(query.toLowerCase())
      )
    : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-16">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-red">Covenants</p>
          <h1 className="display-heading mt-2 text-3xl text-fg sm:text-4xl">Every truth-bond, live</h1>
          <p className="mt-2 max-w-xl text-fg-secondary">
            Browse standing covenants across every seller, endpoint, and spec.
          </p>
        </div>
        <Button asChild>
          <Link href="/create">
            <Plus className="h-4 w-4" /> Post a covenant
          </Link>
        </Button>
      </div>

      <div className="mt-10 relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search covenants by service or endpoint…"
          className="pl-11"
        />
      </div>

      <div className="mt-10">
        {error && (
          <EmptyState
            title="Couldn't load covenants"
            description={error}
            action={<Button onClick={() => setRefreshTick((t) => t + 1)}>Retry</Button>}
          />
        )}

        {!error && !isSentinelFactoryDeployed() && (
          <EmptyState
            title="SentinelFactory not deployed yet"
            description="This deployment of the app isn't pointed at a live SentinelFactory contract yet. Once deployed, every posted covenant will appear here automatically."
            action={
              <Button variant="secondary" asChild>
                <Link href="/agents">Read the Agent SDK docs</Link>
              </Button>
            }
          />
        )}

        {!error && isSentinelFactoryDeployed() && covenants === null && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-44 rounded-3xl" />
            ))}
          </div>
        )}

        {!error && isSentinelFactoryDeployed() && covenants !== null && covenants.length === 0 && (
          <EmptyState
            title="No covenants posted yet"
            description="Be the first to bond a live endpoint's advertised spec to real GEN."
            action={
              <Button asChild>
                <Link href="/create">
                  <Plus className="h-4 w-4" /> Post the first covenant
                </Link>
              </Button>
            }
          />
        )}

        {!error && filtered && filtered.length > 0 && (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.05 } } }}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {filtered.map((meta) => (
              <motion.div
                key={meta.address}
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              >
                <CovenantCard meta={meta} />
              </motion.div>
            ))}
          </motion.div>
        )}

        {!error && filtered && filtered.length === 0 && covenants && covenants.length > 0 && (
          <EmptyState title="No matches" description="Try a different search term." />
        )}
      </div>
    </div>
  );
}
