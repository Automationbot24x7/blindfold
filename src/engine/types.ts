// Core data types shared by the audit engine and the UI.

export type Direction = 'out' | 'in';

/** Payment rail parsed from the narration (how the money moved). */
export type Rail =
  | 'UPI' | 'NEFT' | 'IMPS' | 'RTGS' | 'ATM' | 'POS' | 'NACH' | 'ACH' | 'CHEQUE' | 'CASH'
  | 'CARD' | 'CHECK' | 'WIRE' | 'INTEREST' | 'CHARGES' | 'TAX' | 'TRANSFER' | 'OTHER';

export type CategorySource = 'rule' | 'memory' | 'device' | 'cloud' | 'user' | 'none';

export type CounterpartyKind = 'PERSON' | 'BUSINESS' | 'SELF' | 'BANK' | 'GOVERNMENT' | 'NONE';

/** One normalised bank-statement line. Raw text lives only in the browser. */
export interface Txn {
  id: number;
  date: string; // ISO yyyy-mm-dd
  narration: string;
  amount: number; // always positive
  direction: Direction;
  balance?: number;
  ref?: string;
  rail: Rail;
  counterparty: string; // as written in the narration ('' when none)
  counterpartyKey: string; // normalised key for grouping
  counterpartyKind: CounterpartyKind;
  vpa?: string; // UPI ID if present
  note: string; // free text after the structured part
  category?: string;
  categorySource: CategorySource;
  categoryReason?: string;
  unsure?: boolean;
}

export type FindingKind =
  | 'DUPLICATE_PAYMENT'
  | 'ROUND_TRIP'
  | 'STRUCTURING'
  | 'SPLIT_PAYMENT'
  | 'PERSONAL_SPEND'
  | 'AMOUNT_SPIKE';

export type Severity = 'high' | 'medium' | 'low';

/** A pattern found by deterministic code. Every number in it is computed by code, never by a model. */
export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  title: string; // code-written headline, uses real names (local only)
  facts: Record<string, string | number>;
  txnIds: number[];
  review?: Review; // filled after the blind review
  sentText?: string; // exactly what left the device for this finding
  reviewStatus?: 'pending' | 'done' | 'failed' | 'blocked' | 'skipped'; // skipped = over the per-audit limit, waits for a click
  reviewError?: string; // why the review did not come back (shown with a "Try again" button)
}

export type Verdict = 'LIKELY_ISSUE' | 'NEEDS_EXPLANATION' | 'LIKELY_FINE';

export interface Review {
  verdict: Verdict;
  explanation: string; // restored with real names locally for display
  clientQuestion: string;
  maskedExplanation: string; // exactly as returned (placeholders)
  maskedClientQuestion: string;
  source: 'in_cloud' | 'on_device';
  model?: string;
  ms: number;
}
