import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const FACTORY = (process.env.FACTORY_ADDRESS ?? "0x69FeCf753243F6DE8E202E2Ea499B04A389ACc98") as `0x${string}`;
const SIGNALS_SOURCE = "contracts/SentinelSignals.py";

async function main() {
  const key = process.env.PRIVATE_KEY ?? process.env.BRADBURY_DEPLOY_PRIVATE_KEY;
  if (!key) throw new Error("Set PRIVATE_KEY or BRADBURY_DEPLOY_PRIVATE_KEY.");

  const account = createAccount(key as `0x${string}`);
  const client = createClient({ chain: studioDevnet, account });
  const source = readFileSync(SIGNALS_SOURCE, "utf-8");
  const signer = account.address;
  console.log(`E2E signer: ${signer}`);
  console.log(`Factory: ${FACTORY}`);
  console.log(`Source: ${source.length} bytes`);

  async function fees() {
    const estimate = await client.estimateTransactionFees();
    return { distribution: estimate.distribution, feeValue: estimate.feeValue };
  }

  async function wait(hash: `0x${string}`) {
    for (let i = 0; i < 200; i++) {
      const tx = await client.getTransaction({ hash });
      if (
        tx.statusName === TransactionStatus.FINALIZED ||
        tx.statusName === TransactionStatus.UNDETERMINED ||
        tx.statusName === TransactionStatus.CANCELED
      ) {
        return tx;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`Timed out waiting for ${hash}`);
  }

  async function write(label: string, args: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
    value?: bigint;
    consensusMaxRotations?: number;
  }) {
    const hash = await client.writeContract({
      address: args.address,
      functionName: args.functionName,
      args: args.args,
      value: args.value ?? 0n,
      fees: await fees(),
      consensusMaxRotations: args.consensusMaxRotations,
    });
    const tx = await wait(hash);
    console.log(
      `  ${label}: ${hash} -> ${tx.statusName} ${tx.txExecutionResultName ?? ""} ${tx.resultName ?? ""}`
    );
    return { hash, tx };
  }

  async function expectError(label: string, args: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
    value?: bigint;
  }) {
    const { hash, tx } = await write(label, args);
    assert.equal(tx.txExecutionResultName, "FINISHED_WITH_ERROR", `${label} should revert`);
    console.log(`  ${label}: reverted as expected (${hash})`);
    return hash;
  }

  function read<T>(address: `0x${string}`, functionName: string, args: unknown[] = []) {
    return client.readContract({ address, functionName, args }) as Promise<T>;
  }

  console.log("\n[1] Deploy SentinelSignals covenant");
  const deployHash = await client.deployContract({
    code: source,
    args: ["Sentinel E2E", "https://example.com", "The page must stay reachable.", 1, 1],
    fees: await fees(),
  });
  const deployedTx = await wait(deployHash);
  assert.equal(deployedTx.txExecutionResultName, "FINISHED_WITH_RETURN");
  const deployed = deployedTx as any;
  const covenant = (deployed.txDataDecoded?.contractAddress ??
    deployed.contractAddress ??
    deployed.to_address) as `0x${string}`;
  assert.ok(covenant, "missing deployed address");
  console.log(`  covenant: ${covenant} (${deployHash})`);

  console.log("\n[2] Register the covenant with the new factory");
  await write("register_covenant", {
    address: FACTORY,
    functionName: "register_covenant",
    args: [covenant],
    value: 0n,
  });
  const meta = await read<Record<string, unknown>>(FACTORY, "get_covenant_meta", [covenant]);
  assert.equal(String(meta.address).toLowerCase(), covenant.toLowerCase());
  console.log(`  factory meta: ${JSON.stringify(meta)}`);

  console.log("\n[3] Fund the seller bond");
  await write("fund_bond", {
    address: covenant,
    functionName: "fund_bond",
    args: [],
    value: 10n,
  });
  const funded = await read<Record<string, string>>(covenant, "get_covenant_info");
  assert.equal(funded.status, "active");
  assert.equal(funded.bond, "10");
  console.log(`  covenant status: ${funded.status}, bond: ${funded.bond} wei`);

  const now = Math.floor(Date.now() / 1000);

  console.log("\n[4] Create the primary signal");
  await write("create_audit_signal #0", {
    address: covenant,
    functionName: "create_audit_signal",
    args: [
      "E2E example probe",
      "https://example.com",
      "The response body contains the phrase Example Domain.",
      60,
      4,
      1,
      now + 3600,
    ],
    value: 10n,
  });

  console.log("\n[5] Create a short-lived signal for expiry");
  await write("create_audit_signal #1", {
    address: covenant,
    functionName: "create_audit_signal",
    args: [
      "E2E expiry probe",
      "https://example.com",
      "The response body contains the phrase Example Domain.",
      60,
      1,
      0,
      now + 60,
    ],
    value: 3n,
  });

  console.log("\n[6] Poll signal #0 (first poll is not rate-limited)");
  const poll = await write("poll_audit_signal #0", {
    address: covenant,
    functionName: "poll_audit_signal",
    args: ["0"],
    consensusMaxRotations: 5,
  });
  const signal0 = await read<Record<string, string>>(covenant, "get_signal", ["0"]);
  const polls0 = await read<Record<string, string>[]>(covenant, "get_signal_polls", ["0"]);
  assert.equal(signal0.last_outcome, "hit");
  assert.equal(signal0.payout_count, "1");
  assert.equal(signal0.poll_count, "1");
  assert.equal(signal0.pool_remaining, "6");
  assert.equal(polls0.length, 1);
  assert.equal(polls0[0].payout, "4");
  assert.equal(polls0[0].outcome, "hit");
  console.log(
    `  poll ${poll.hash}: outcome=${signal0.last_outcome} payout=${polls0[0].payout} wei pool=${signal0.pool_remaining} wei`
  );

  console.log("\n[7] Poll again immediately -> rate-limited revert");
  await expectError("poll #0 too soon", {
    address: covenant,
    functionName: "poll_audit_signal",
    args: ["0"],
    consensusMaxRotations: 5,
  });
  const afterRateLimit = await read<Record<string, string>>(covenant, "get_signal", ["0"]);
  assert.equal(afterRateLimit.pool_remaining, "6");
  assert.equal(afterRateLimit.payout_count, "1");

  console.log("\n[8] claim_signal -> always reverts, no second payout");
  await expectError("claim_signal #0", {
    address: covenant,
    functionName: "claim_signal",
    args: ["0"],
  });
  const afterClaim = await read<Record<string, string>>(covenant, "get_signal", ["0"]);
  assert.equal(afterClaim.pool_remaining, "6");
  assert.equal(afterClaim.total_paid, "4");
  assert.equal(afterClaim.payout_count, "1");
  console.log(`  pool still ${afterClaim.pool_remaining} wei, total paid still ${afterClaim.total_paid} wei`);

  console.log("\n[9] Pause -> poll must fail");
  await write("pause_signal #0", {
    address: covenant,
    functionName: "pause_signal",
    args: ["0"],
  });
  assert.equal((await read<Record<string, string>>(covenant, "get_signal", ["0"])).status, "paused");
  await expectError("poll paused #0", {
    address: covenant,
    functionName: "poll_audit_signal",
    args: ["0"],
    consensusMaxRotations: 5,
  });

  console.log("\n[10] Resume -> top up");
  await write("resume_signal #0", {
    address: covenant,
    functionName: "resume_signal",
    args: ["0"],
  });
  assert.equal((await read<Record<string, string>>(covenant, "get_signal", ["0"])).status, "active");
  await write("top_up_signal #0", {
    address: covenant,
    functionName: "top_up_signal",
    args: ["0"],
    value: 5n,
  });
  const toppedUp = await read<Record<string, string>>(covenant, "get_signal", ["0"]);
  assert.equal(toppedUp.pool_remaining, "11");
  console.log(`  pool after top-up: ${toppedUp.pool_remaining} wei`);

  console.log("\n[11] Cancel -> pull-based refund");
  await write("cancel_signal #0", {
    address: covenant,
    functionName: "cancel_signal",
    args: ["0"],
  });
  const cancelled = await read<Record<string, string>>(covenant, "get_signal", ["0"]);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.creator_refundable, "11");
  await expectError("poll cancelled #0", {
    address: covenant,
    functionName: "poll_audit_signal",
    args: ["0"],
    consensusMaxRotations: 5,
  });

  console.log("\n[12] Claim the refund");
  const refundBefore = await read<string>(covenant, "get_signal_refund", [signer]);
  assert.equal(refundBefore, "11");
  await write("claim_refund", {
    address: covenant,
    functionName: "claim_refund",
    args: [],
  });
  const refundAfter = await read<string>(covenant, "get_signal_refund", [signer]);
  assert.equal(refundAfter, "0");
  console.log(`  refund before=${refundBefore} wei after=${refundAfter} wei`);

  console.log("\n[13] Wait for signal #1 to expire, then expire it");
  const signal1 = await read<Record<string, string>>(covenant, "get_signal", ["1"]);
  const waitMs = Math.max(0, (Number(signal1.expires_at) + 2) * 1000 - Date.now());
  if (waitMs > 0) {
    console.log(`  waiting ${Math.ceil(waitMs / 1000)}s for expiry`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  await write("expire_signal #1", {
    address: covenant,
    functionName: "expire_signal",
    args: ["1"],
  });
  const expired = await read<Record<string, string>>(covenant, "get_signal", ["1"]);
  assert.equal(expired.status, "expired");
  assert.equal(expired.creator_refundable, "3");
  await write("claim_refund (expiry)", {
    address: covenant,
    functionName: "claim_refund",
    args: [],
  });
  assert.equal(await read<string>(covenant, "get_signal_refund", [signer]), "0");

  console.log("\n[14] Final state");
  const finalSignal0 = await read<Record<string, string>>(covenant, "get_signal", ["0"]);
  const finalSignal1 = await read<Record<string, string>>(covenant, "get_signal", ["1"]);
  const count = await read<string>(covenant, "get_signal_count");
  const finalInfo = await read<Record<string, string>>(covenant, "get_covenant_info");
  console.log(
    JSON.stringify(
      { covenant, count, signal0: finalSignal0, signal1: finalSignal1, covenantInfo: finalInfo },
      null,
      2
    )
  );

  console.log("\nE2E PASSED");
  console.log(`Covenant: ${covenant}`);
  console.log(`Deploy tx: ${deployHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
