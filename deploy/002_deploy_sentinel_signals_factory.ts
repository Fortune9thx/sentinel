/**
 * Deploys SentinelSignalsFactory.py (with SentinelSignals.py embedded as its
 * constructor argument) to Studio Devnet and points frontend/lib/contracts.ts
 * at the resulting address only after the deployment reaches FINALIZED with
 * FINISHED_WITH_RETURN.
 *
 * Usage:
 *   PRIVATE_KEY=0x... CREATION_STAKE_WEI=0 npx tsx deploy/002_deploy_sentinel_signals_factory.ts studio-dev
 *
 * Falls back to BRADBURY_DEPLOY_PRIVATE_KEY from the environment when
 * PRIVATE_KEY is not set, matching the key already used for this repo's live
 * deployments.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SIGNALS_PATH = join(ROOT, "contracts", "SentinelSignals.py");
const FACTORY_PATH = join(ROOT, "contracts", "SentinelSignalsFactory.py");
const CONTRACTS_TS_PATH = join(ROOT, "frontend", "lib", "contracts.ts");

const TERMINAL_STATUSES = new Set([
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.LEADER_TIMEOUT,
  TransactionStatus.VALIDATORS_TIMEOUT,
]);

async function pollUntilTerminal(
  client: ReturnType<typeof createClient>,
  hash: `0x${string}`,
  { intervalMs = 3000, maxAttempts = 140 } = {}
) {
  let lastStatus: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const transaction = await client.getTransaction({ hash });
    const status = transaction.statusName ?? TransactionStatus.PENDING;
    if (status !== lastStatus) {
      console.log(`  status: ${status}`);
      lastStatus = status;
    }
    if (TERMINAL_STATUSES.has(status)) return transaction;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for deployment to reach a terminal status");
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY ?? process.env.BRADBURY_DEPLOY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Set PRIVATE_KEY or BRADBURY_DEPLOY_PRIVATE_KEY before deploying.");
  }
  const creationStakeWei = BigInt(process.env.CREATION_STAKE_WEI ?? "0");
  const account = createAccount(privateKey as `0x${string}`);
  const client = createClient({ chain: studioDevnet, account });

  const signalsSource = readFileSync(SIGNALS_PATH, "utf-8");
  const factorySource = readFileSync(FACTORY_PATH, "utf-8");

  console.log(
    `Deploying SentinelSignalsFactory to ${studioDevnet.name} as ${account.address} (SentinelSignals.py source: ${signalsSource.length} bytes)...`
  );

  let fees: Awaited<ReturnType<typeof client.estimateTransactionFees>> | undefined;
  try {
    fees = await client.estimateTransactionFees();
    console.log(`  fee estimate: feeValue=${fees.feeValue}`);
  } catch {
    // Non-v0.6 networks do not require explicit fees.
  }

  const hash = await client.deployContract({
    code: factorySource,
    args: [signalsSource, creationStakeWei],
    ...(fees ? { fees: { distribution: fees.distribution, feeValue: fees.feeValue } } : {}),
  });
  console.log(`Deploy tx: ${hash}`);

  const transaction = await pollUntilTerminal(client, hash);
  if (transaction.statusName !== TransactionStatus.FINALIZED) {
    throw new Error(`Deployment did not finalize (status: ${transaction.statusName}).`);
  }
  if (transaction.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    throw new Error(
      `Deployment finalized but did not return successfully (execution result: ${transaction.txExecutionResultName}).`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = transaction as any;
  const deployedAddress = (tx.txDataDecoded?.contractAddress ?? tx.contractAddress ?? tx.to_address) as
    | `0x${string}`
    | undefined;
  if (!deployedAddress) {
    throw new Error(`Deployment succeeded but no contract address was found: ${JSON.stringify(transaction)}`);
  }

  const contractsTs = readFileSync(CONTRACTS_TS_PATH, "utf-8");
  const updated = contractsTs.replace(
    /(studioDev:\s*)(?:"0x[a-fA-F0-9]{40}"|undefined)/,
    `$1"${deployedAddress}"`
  );
  if (updated === contractsTs) {
    throw new Error(`Could not find the studioDev entry to update in ${CONTRACTS_TS_PATH}.`);
  }
  writeFileSync(CONTRACTS_TS_PATH, updated);
  console.log(`Written to frontend/lib/contracts.ts under "studioDev".`);

  console.log(`\nDeployed SentinelSignalsFactory at ${deployedAddress}`);
  console.log(`Deploy tx hash: ${hash}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
