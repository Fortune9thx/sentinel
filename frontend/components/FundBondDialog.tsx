"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionPanel } from "@/components/TransactionPanel";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { useGenLayerClient } from "@/lib/genlayer-client";
import { fundBond } from "@/lib/sentinel-calls";
import { parseGenToWei } from "@/lib/utils";

export function FundBondDialog({
  open,
  onOpenChange,
  covenantAddress,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  covenantAddress: `0x${string}`;
  onSuccess?: () => void;
}) {
  const { client } = useGenLayerClient();
  const { state, run, reset } = useTransactionLifecycle(client);
  const [amount, setAmount] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const busy = state.phase === "submitting" || state.phase === "polling";

  const handleSubmit = () => {
    setValidationError(null);
    let wei: bigint;
    try {
      wei = parseGenToWei(amount);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Invalid amount.");
      return;
    }
    if (wei <= 0n) {
      setValidationError("Amount must be greater than zero.");
      return;
    }
    run(() => fundBond(client!, covenantAddress, wei)).then(() => {
      if (onSuccess) onSuccess();
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fund the bond</DialogTitle>
          <DialogDescription>
            Add to your covenant&rsquo;s bond. If it hasn&rsquo;t reached its minimum bond yet, it activates
            automatically the moment this top-up crosses that threshold.
          </DialogDescription>
        </DialogHeader>

        {state.phase === "idle" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Amount (GEN)</label>
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1.0"
              />
              {validationError && <p className="mt-1.5 text-xs text-negative">{validationError}</p>}
            </div>
            <Button onClick={handleSubmit} disabled={!client || busy}>
              {client ? "Fund bond" : "Connect a wallet to continue"}
            </Button>
          </div>
        ) : (
          <TransactionPanel state={state} onReset={() => handleOpenChange(false)} successLabel="Bond funded" />
        )}
      </DialogContent>
    </Dialog>
  );
}
