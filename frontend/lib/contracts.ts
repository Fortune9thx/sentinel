/**
 * Deployed SentinelFactory contract address, keyed by network. Populated by
 * deploy/001_deploy_sentinel_factory.ts after a real deployment -- undefined
 * until then, in which case the app surfaces an explicit "not deployed yet"
 * state rather than a silently broken read.
 */
export type SentinelNetworkKey = "bradbury" | "studio" | "studioDev" | "asimov";

export const SENTINEL_FACTORY_ADDRESSES: Record<SentinelNetworkKey, `0x${string}` | undefined> = {
  bradbury: "0x5D26afe860160c78fF77A7e7EC89c322b165E824",
  studio: undefined,
  studioDev: "0x0469f87EeFb340C7E6C47cef06e52AFc87BBAdDf",
  asimov: undefined,
};

// Bradbury's gen_call read path has been down network-wide since 2026-09-08
// (confirmed via the official genlayer CLI, unrelated to this project's own
// code -- see docs/AUDIT.md). Studio Devnet (Consensus v0.6 preview) is the
// live, working network as of 2026-09-12.
export const SENTINEL_ACTIVE_NETWORK: SentinelNetworkKey = "studioDev";

/**
 * Resolution order: an explicit env override (useful for pointing a local
 * dev build at a different deploy without editing this file) first, then
 * the address deploy/001_deploy_sentinel_factory.ts wrote here.
 */
export function getSentinelFactoryAddress(): `0x${string}` | undefined {
  const override = process.env.NEXT_PUBLIC_SENTINEL_FACTORY_ADDRESS;
  return (override || SENTINEL_FACTORY_ADDRESSES[SENTINEL_ACTIVE_NETWORK]) as `0x${string}` | undefined;
}

export function isSentinelFactoryDeployed(): boolean {
  return Boolean(getSentinelFactoryAddress());
}
