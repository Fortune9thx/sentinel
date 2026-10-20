export type SignalStatus = "active" | "paused" | "cancelled" | "expired" | "exhausted" | "";
export type SignalOutcome = "hit" | "miss" | "inconclusive" | "";

export interface SignalRecord {
  id: string;
  creator: string;
  label: string;
  endpoint_url: string;
  rule: string;
  interval_seconds: string;
  reward_per_hit: string;
  stipend: string;
  created_at: string;
  expires_at: string;
  status: SignalStatus;
  poll_count: string;
  hit_count: string;
  miss_count: string;
  inconclusive_count: string;
  consecutive_hits: string;
  last_poll_at: string;
  last_outcome: SignalOutcome;
  last_fingerprint: string;
  total_paid: string;
  payout_count: string;
  refunded: string;
  closed_at?: string;
  pool_remaining: string;
  creator_refundable: string;
}

export interface SignalPoll {
  id: string;
  outcome: SignalOutcome;
  payout: string;
  confidence: string;
  reasoning: string;
  evidence_snapshot: string;
  fingerprint: string;
  poller: string;
  polled_at: string;
}

export const MIN_SIGNAL_INTERVAL_SECONDS = 60;
