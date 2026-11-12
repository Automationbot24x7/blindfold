// Deterministic first pass: rows whose head is obvious from the rail or a keyword never
// need a model at all. Returns undefined when the row needs language understanding.
import type { Txn } from './types';

interface Rule { code: string; why: string; test: (t: Txn, text: string) => boolean }

const RULES: Rule[] = [
  { code: 'ATM', why: 'cash withdrawal rail', test: t => t.rail === 'ATM' && t.direction === 'out' },
  { code: 'CSH', why: 'cash deposit', test: (t, s) => t.direction === 'in' && (t.rail === 'CASH' || /\bCASH DEP|BY CASH|CASH DEPOSIT\b/.test(s)) },
  { code: 'INT', why: 'interest credit', test: t => t.rail === 'INTEREST' && t.direction === 'in' },
  { code: 'CHG', why: 'bank charge', test: t => t.rail === 'CHARGES' && t.direction === 'out' },
  { code: 'TAX', why: 'tax payment', test: (t, s) => t.direction === 'out' && (t.rail === 'TAX' || t.counterpartyKind === 'GOVERNMENT' || /\b(CHALLAN|CBDT|EFTPS)\b/.test(s)) },
  { code: 'RFD', why: 'reversal or refund', test: (t, s) => t.direction === 'in' && /\b(REV|REVERSAL|REFUND)\b/.test(s) },
  { code: 'OWN', why: 'own-account transfer', test: t => t.counterpartyKind === 'SELF' },
  { code: 'EMI', why: 'loan instalment mandate', test: (t, s) => t.direction === 'out' && (t.rail === 'NACH' || t.rail === 'ACH') && /\b(LOAN|LOANS|FINANCE|EMI|MORTGAGE|CAPITAL)\b/.test(s) },
  { code: 'INS', why: 'insurance premium', test: (t, s) => t.direction === 'out' && /\b(INSURANCE|PREMIUM|ASSURANCE)\b/.test(s) },
  { code: 'WAG', why: 'salary keyword on a payment', test: (t, s) => t.direction === 'out' && /\b(SALARY|WAGES|PAYROLL)\b/.test(s) },
  { code: 'RNT', why: 'rent keyword on a payment', test: (t, s) => t.direction === 'out' && /\bRENT\b/.test(s) },
  { code: 'UTL', why: 'utility keyword', test: (t, s) => t.direction === 'out' && /\b(ELECTRICITY|ELECTRIC|POWER BOARD|POWER CO|WATER BOARD|WATER DEPT|BROADBAND|INTERNET|FIBER|WIRELESS|POSTPAID|PREPAID|MOBILE RECHARGE|GAS BILL|GAS CO|UTIL)\b/.test(s) },
];

export function ruleCategory(t: Txn): { code: string; why: string } | undefined {
  const text = `${t.narration} ${t.note}`.toUpperCase();
  for (const r of RULES) if (r.test(t, text)) return { code: r.code, why: r.why };
  return undefined;
}
