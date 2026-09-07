export const SENTINEL_FACTORY_METHODS = {
  createCovenant: "create_covenant",
  withdrawFees: "withdraw_fees",
  getOwner: "get_owner",
  getCreationStake: "get_creation_stake",
  getCollectedFees: "get_collected_fees",
  getCovenants: "get_covenants",
  getCovenantsCount: "get_covenants_count",
  getCovenantsPage: "get_covenants_page",
  getCovenantMeta: "get_covenant_meta",
  getCovenantsBySeller: "get_covenants_by_seller",
} as const;

export const SENTINEL_METHODS = {
  fundBond: "fund_bond",
  registerAsBeneficiary: "register_as_beneficiary",
  audit: "audit",
  claimSlashShare: "claim_slash_share",
  requestExit: "request_exit",
  withdrawRemainingBond: "withdraw_remaining_bond",
  getCovenantInfo: "get_covenant_info",
  getAudit: "get_audit",
  getAudits: "get_audits",
  getBreach: "get_breach",
  getBreaches: "get_breaches",
  isBeneficiary: "is_beneficiary",
  getClaimable: "get_claimable",
  isClaimed: "is_claimed",
} as const;

export type CovenantStatus = "pending_bond" | "active" | "exiting" | "exited" | "";

export type AuditOutcome = "compliant" | "violation" | "inconclusive" | "unreachable" | "unreachable_escalated" | "";

export interface CovenantMeta {
  address: string;
  service_name: string;
  endpoint_url: string;
  spec: string;
  slash_amount: string;
  min_bond: string;
  seller: string;
  created_at: string;
  creation_stake: string;
}

export interface CovenantInfo {
  address_seller: string;
  service_name: string;
  endpoint_url: string;
  spec: string;
  slash_amount: string;
  min_bond: string;
  bond: string;
  status: CovenantStatus;
  created_at: string;
  exit_requested_at: string;
  audit_count: string;
  last_audit_at: string;
  consecutive_failures: string;
  total_violations: string;
  total_breaches: string;
  beneficiary_count: number;
}

export interface AuditRecord {
  id: string;
  outcome: AuditOutcome;
  compliant: boolean;
  confidence: string;
  reasoning: string;
  evidence_snapshot: string;
  evaluated_at: string;
  breach_id: string;
}

export interface BreachRecord {
  id: string;
  audit_id: string;
  slash_amount: string;
  eligible_count: number;
  evaluated_at: string;
  pool_remaining: string;
  eligible?: string[];
}

// Mirrors the contract-side constants in contracts/Sentinel.py -- kept in
// sync manually since GenVM contract source isn't introspectable from the
// frontend build. Used for explanatory copy (why an audit is rate-limited,
// what "sustained" unreachability means), never for enforcement itself --
// the contract is the sole source of truth for anything that gates funds.
export const FAILURE_THRESHOLD = 3;
export const MIN_AUDIT_INTERVAL_SECONDS = 300;
export const UNREACHABLE_ESCALATION_SECONDS = 3600;
export const EXIT_COOLDOWN_SECONDS = 259200;
