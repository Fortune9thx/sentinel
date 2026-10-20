import type { GenLayerClient, GenLayerChain, GenLayerTransaction } from "genlayer-js/types";
import { SENTINEL_FACTORY_METHODS, SENTINEL_METHODS, SENTINEL_SIGNAL_METHODS } from "./sentinel-abi";
import type { CovenantMeta, CovenantInfo, AuditRecord, BreachRecord } from "./sentinel-abi";
import type { SignalRecord, SignalPoll } from "./signal-types";
import { writeContractWithFees, deployContractWithFees, pollConsensusStatus } from "./genlayer-client";
import { SENTINEL_SOURCE } from "./sentinel-source";

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

export async function fetchFactoryOwner(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.getOwner,
    args: [],
  });
  return result as unknown as string;
}

export async function fetchIsCovenantVerified(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  covenantAddress: string
): Promise<boolean> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.isCovenantVerified,
    args: [covenantAddress],
  });
  return result as unknown as boolean;
}

/**
 * Owner-only. A covenant created via create_covenant() is auto-verified (the
 * factory deployed that exact bytecode itself); one admitted via
 * register_covenant() -- the deploy-then-register workaround for the
 * internal-deploy fee-allocation gap -- starts unverified until the factory
 * owner reviews its actual deployed source and calls this. Does not affect
 * whether the covenant is listed or usable -- see verify_covenant's own
 * docstring in SentinelFactory.py.
 */
export async function verifyCovenant(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.verifyCovenant,
    args: [covenantAddress],
    value: 0n,
  });
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

export async function withdrawFees(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.withdrawFees,
    args: [],
    value: 0n,
  });
}

/**
 * Covenant creation is a two-step flow, not a single create_covenant call:
 *
 * 1. Deploy Sentinel.py directly (a real top-level deploy transaction).
 * 2. Register the deployed address with the factory via register_covenant.
 *
 * This deliberately bypasses SentinelFactory.create_covenant()'s own
 * internal gl.contract.deploy() call -- Consensus v0.6's internal-message
 * fee-allocation system currently rejects that path with
 * `fee no_matching_allocation # internal`, a confirmed live, unresolved
 * platform gap (see docs/AUDIT.md), not something fixable in this app's own
 * code. register_covenant independently verifies the deployed address
 * responds as a real Sentinel covenant (a live cross-contract view call)
 * before registering it, rather than trusting caller-supplied metadata.
 *
 * onCovenantAddress fires as soon as the address is known (right after step
 * 1 finalizes), before step 2 is even submitted -- callers can use this to
 * update UI/navigation state without waiting for the full two-step flow to
 * settle, since a confirmed deploy is itself strong evidence of success even
 * if the registration step is still in flight.
 */
export async function createCovenantDirect(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  serviceName: string,
  endpointUrl: string,
  spec: string,
  slashAmount: bigint,
  minBond: bigint,
  creationStakeValue: bigint,
  onCovenantAddress?: (address: `0x${string}`) => void
): Promise<`0x${string}`> {
  const deployHash = await deployContractWithFees(client, {
    code: SENTINEL_SOURCE,
    args: [serviceName, endpointUrl, spec, slashAmount, minBond],
  });
  const deployTx: GenLayerTransaction = await pollConsensusStatus(client, deployHash, () => {}, {
    requireFinalized: true,
  });
  if (deployTx.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    throw new Error(
      `Covenant deployment reached consensus but did not return successfully (execution result: ${
        deployTx.txExecutionResultName ?? "unknown"
      }).`
    );
  }
  // genlayer-js's GenLayerTransaction has put the deployed address at
  // slightly different paths across versions/receipt shapes in prior
  // verification on this stack -- check every known location rather than
  // assume just one, so a real successful deploy never gets misreported as
  // "no address found" over a receipt-shape difference.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deployTxAny = deployTx as any;
  const covenantAddress = (deployTxAny.txDataDecoded?.contractAddress ??
    deployTxAny.contractAddress ??
    deployTxAny.to_address) as `0x${string}` | undefined;
  if (!covenantAddress) {
    throw new Error("Deployment succeeded but no contract address was found in the receipt.");
  }
  onCovenantAddress?.(covenantAddress);

  return registerCovenant(client, factoryAddress, covenantAddress, creationStakeValue);
}

/**
 * The registration half of createCovenantDirect, callable standalone. Needed
 * because deploy and register are two separate signed transactions -- if the
 * deploy succeeds but the user rejects (or a network hiccup drops) the
 * second signature, a real, already-deployed, gas-paid covenant would
 * otherwise be silently orphaned (undiscoverable in the registry, with the
 * UI's only recourse being to deploy a brand new duplicate). Exposing this
 * separately lets the UI retry just the registration step against the
 * already-known address instead.
 */
export async function registerCovenant(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  covenantAddress: `0x${string}`,
  creationStakeValue: bigint
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: factoryAddress,
    functionName: SENTINEL_FACTORY_METHODS.registerCovenant,
    args: [covenantAddress],
    value: creationStakeValue,
  });
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
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_METHODS.fundBond,
    args: [],
    value,
  });
}

export async function registerAsBeneficiary(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_METHODS.registerAsBeneficiary,
    args: [],
    value: 0n,
  });
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
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_METHODS.audit,
    args: [],
    value: 0n,
    consensusMaxRotations: AUDIT_MAX_ROTATIONS,
  });
}

export async function claimSlashShare(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  breachId: string
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_METHODS.claimSlashShare,
    args: [breachId],
    value: 0n,
  });
}

export async function requestExit(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_METHODS.requestExit,
    args: [],
    value: 0n,
  });
}

export async function withdrawRemainingBond(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_METHODS.withdrawRemainingBond,
    args: [],
    value: 0n,
  });
}

// ---------------------------------------------------------------------
// Continuous Audit Signals (SentinelSignals covenant contract)
// ---------------------------------------------------------------------

export async function fetchSignals(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<SignalRecord[]> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.getSignals,
    args: [],
  });
  return result as unknown as SignalRecord[];
}

export async function fetchSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string
): Promise<SignalRecord> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.getSignal,
    args: [signalId],
  });
  return result as unknown as SignalRecord;
}

export async function fetchSignalPolls(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string
): Promise<SignalPoll[]> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.getSignalPolls,
    args: [signalId],
  });
  return result as unknown as SignalPoll[];
}

export async function fetchSignalRefund(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  address: string
): Promise<string> {
  const result = await client.readContract({
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.getSignalRefund,
    args: [address],
  });
  return result as unknown as string;
}

export async function createAuditSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  input: {
    label: string;
    endpointUrl: string;
    rule: string;
    intervalSeconds: number;
    rewardPerHit: bigint;
    stipend: bigint;
    expiresAt: number;
  },
  value: bigint
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.createAuditSignal,
    args: [
      input.label,
      input.endpointUrl,
      input.rule,
      input.intervalSeconds,
      input.rewardPerHit,
      input.stipend,
      input.expiresAt,
    ],
    value,
  });
}

export async function topUpSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string,
  value: bigint
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.topUpSignal,
    args: [signalId],
    value,
  });
}

export async function pollSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.pollAuditSignal,
    args: [signalId],
    value: 0n,
    consensusMaxRotations: AUDIT_MAX_ROTATIONS,
  });
}

export async function pauseSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.pauseSignal,
    args: [signalId],
    value: 0n,
  });
}

export async function resumeSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.resumeSignal,
    args: [signalId],
    value: 0n,
  });
}

export async function cancelSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.cancelSignal,
    args: [signalId],
    value: 0n,
  });
}

export async function expireSignal(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`,
  signalId: string
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.expireSignal,
    args: [signalId],
    value: 0n,
  });
}

export async function claimSignalRefund(
  client: GenLayerClient<GenLayerChain>,
  covenantAddress: `0x${string}`
): Promise<`0x${string}`> {
  return writeContractWithFees(client, {
    address: covenantAddress,
    functionName: SENTINEL_SIGNAL_METHODS.claimRefund,
    args: [],
    value: 0n,
  });
}
