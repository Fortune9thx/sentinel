/**
 * Deployed SentinelFactory contract address, keyed by network. Populated by
 * deploy/001_deploy_sentinel_factory.ts after a real deployment -- undefined
 * until then, in which case the app surfaces an explicit "not deployed yet"
 * state rather than a silently broken read.
 */
export type SentinelNetworkKey = "bradbury" | "studio" | "asimov";

export const SENTINEL_FACTORY_ADDRESSES: Record<SentinelNetworkKey, `0x${string}` | undefined> = {
  bradbury: undefined,
  studio: undefined,
  asimov: undefined,
};

export const SENTINEL_ACTIVE_NETWORK: SentinelNetworkKey = "bradbury";

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
