"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { getReadOnlyClient } from "./genlayer-client";

export const STUDIO_DEV_CHAIN_ID = 61997;

export function useSignalWriteGate(covenantAddress?: `0x${string}`) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSchemaReady(null);
    if (!covenantAddress) return;
    getReadOnlyClient()
      .getContractSchema(covenantAddress)
      .then((schema) => {
        if (cancelled) return;
        setSchemaReady(Boolean(schema?.methods && Object.keys(schema.methods).length > 0));
      })
      .catch(() => {
        if (!cancelled) setSchemaReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [covenantAddress]);

  const reason = !isConnected
    ? "Connect a wallet first."
    : chainId !== STUDIO_DEV_CHAIN_ID
      ? "Switch your wallet to GenLayer Studio Dev (chain 61997)."
      : !covenantAddress
        ? "Enter the covenant address this signal belongs to."
        : schemaReady === null
          ? "Checking the covenant on Studio Dev..."
          : schemaReady === false
            ? "No readable SentinelSignals schema was found at this address on Studio Dev."
            : null;

  return { ready: reason === null, reason };
}
