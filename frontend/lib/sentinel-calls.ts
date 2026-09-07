import type { GenLayerClient, GenLayerChain } from "genlayer-js/types";
import { SENTINEL_FACTORY_METHODS, SENTINEL_METHODS } from "./sentinel-abi";
import type { CovenantMeta, CovenantInfo, AuditRecord, BreachRecord } from "./sentinel-abi";

// ---------------------------------------------------------------------
// SentinelFactory reads/writes. Return values are dicts/lists that
// genlayer-js's readContract decodes to plain JSON-safe JS objects by
// default (jsonSafeReturn defaults to true), so no manual JSON parsing is
// needed anywhere below.
// ---------------------------------------------------------------------

export async function fetchCovenants(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string[]> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.getCovenants,
    args: [],
  });
  return result as unknown as string[];
}

export async function fetchCovenantMeta(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  covenantAddress: string
): Promise<CovenantMeta> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.getCovenantMeta,
    args: [covenantAddress],
  });
  return result as unknown as CovenantMeta;
}

export async function fetchCreationStake(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.getCreationStake,
    args: [],
  });
  return result as unknown as string;
}

export async function fetchCollectedFees(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.getCollectedFees,
    args: [],
  });
  return result as unknown as string;
}

export async function createCovenant(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  serviceName: string,
  endpointUrl: string,
  spec: string,
  slashAmount: bigint,
  minBond: bigint,
  value: bigint
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.createCovenant,
    args: [serviceName, endpointUrl, spec, slashAmount, minBond],
    value,
  });
  return hash as `0x${string}`;
}

export async function withdrawFees(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.withdrawFees,
    args: [],
    value: 0n,
  });
  return hash as `0x${string}`;
}

/**
 * create_covenant's write-transaction result exposes ACCEPTED/FINALIZED
 * status, not a decoded method return value in a stable, documented shape
 * -- so rather than depend on undocumented transaction-result decoding,
 * resolve the newly-deployed covenant address the reliable way:
 * covenant_addresses is an append-only registry, so the new covenant is
 * whatever appears at index `beforeCount` once the list grows past it.
 * Retries with a short delay to absorb the same post-ACCEPTED read lag
 * documented for fresh contract state elsewhere in this stack.
 */
export async function waitForNewCovenant(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  beforeCount: number,
  { retries = 10, intervalMs = 3000 }: { retries?: number; intervalMs?: number } = {}
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const covenants = await fetchCovenants(client, factoryAddress);
    if (covenants.length > beforeCount) return covenants[beforeCount];
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for the new covenant to appear in the registry.");
}

// ---------------------------------------------------------------------
// Sentinel (covenant) reads
// ---------------------------------------------------------------------

export async function fetchCovenantInfo(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<CovenantInfo> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.getCovenantInfo,
    args: [],
  });
  return result as unknown as CovenantInfo;
}

export async function fetchAudits(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<AuditRecord[]> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.getAudits,
    args: [],
  });
  return result as unknown as AuditRecord[];
}

export async function fetchBreaches(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<BreachRecord[]> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.getBreaches,
    args: [],
  });
  return result as unknown as BreachRecord[];
}

export async function fetchIsBeneficiary(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  address: string
): Promise<boolean> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.isBeneficiary,
    args: [address],
  });
  return result as unknown as boolean;
}

export async function fetchClaimable(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  breachId: string,
  address: string
): Promise<string> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.getClaimable,
    args: [breachId, address],
  });
  return result as unknown as string;
}

export async function fetchIsClaimed(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  breachId: string,
  address: string
): Promise<boolean> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.isClaimed,
    args: [breachId, address],
  });
  return result as unknown as boolean;
}

// ---------------------------------------------------------------------
// Sentinel (covenant) writes
// ---------------------------------------------------------------------

export async function fundBond(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  value: bigint
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.fundBond,
    args: [],
    value,
  });
  return hash as `0x${string}`;
}

export async function registerAsBeneficiary(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.registerAsBeneficiary,
    args: [],
    value: 0n,
  });
  return hash as `0x${string}`;
}

// audit() is the heaviest call in this contract: a live web fetch + LLM
// compliance judgment, re-run independently by every validator for
// Equivalence Principle agreement. Raised above the SDK's default
// consensusMaxRotations (3) for the same reason every prior GenLayer
// project on this stack raises it for its heaviest write -- more surface
// for one slow/failed leader attempt to eat the default budget before the
// platform gives up.
const AUDIT_MAX_ROTATIONS = 5;

export async function runAudit(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.audit,
    args: [],
    value: 0n,
    consensusMaxRotations: AUDIT_MAX_ROTATIONS,
  });
  return hash as `0x${string}`;
}

export async function claimSlashShare(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  breachId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.claimSlashShare,
    args: [breachId],
    value: 0n,
  });
  return hash as `0x${string}`;
}

export async function requestExit(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.requestExit,
    args: [],
    value: 0n,
  });
  return hash as `0x${string}`;
}

export async function withdrawRemainingBond(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: covenantAddress,
    functionName: SENTINEL_METHODS.withdrawRemainingBond,
    args: [],
    value: 0n,
  });
  return hash as `0x${string}`;
}
