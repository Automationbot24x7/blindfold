// Statement import: finds the transaction table in a bank CSV export and normalises rows.
import Papa from 'papaparse';
import { counterpartyKey, counterpartyKind, parseNarration } from './narration';
import type { Txn } from './types';
import type { Currency } from './detectors';

export interface ColumnMap {
  date: number;
  narration: number;
  debit?: number;
  credit?: number;
  amount?: number; // signed single amount column
  type?: number; // DR/CR column paired with amount
  balance?: number;
  ref?: number;
}

const SYN: Record<keyof ColumnMap, RegExp> = {
  date: /^(txn |transaction |value |posting |tran |booking )?date( posted)?$|^buchungstag$/i,
  narration: /^(narration|description|particulars|remarks|details|transaction details|transaction remarks|memo)$/i,
  debit: /^(withdrawal|withdrawals|withdrawal amt\.?|withdrawal amount|debit|debits|debit amount|dr|dr amount|amount out|money out|paid out|out)( \((inr|usd|gbp|eur)\))?$/i,
  credit: /^(deposit|deposits|deposit amt\.?|deposit amount|credit|credits|credit amount|cr|cr amount|amount in|money in|paid in|in)( \((inr|usd|gbp|eur)\))?$/i,
  amount: /^(amount|transaction amount|amt)( \((inr|usd|gbp|eur)\))?$/i,
  type: /^(type|dr\/cr|cr\/dr|debit\/credit|txn type)$/i,
  balance: /^(balance|closing balance|running balance|available balance|running bal\.?)( \((inr|usd|gbp|eur)\))?$/i,
  ref: /^(chq\.?\/ref\.? ?no\.?|ref no\.?|reference|cheque no\.?|chq no\.?|ref|check number|check no\.?)$/i,
};

export function detectColumns(header: string[]): ColumnMap | undefined {
  const h = header.map(c => c.trim());
  const find = (k: keyof ColumnMap) => {
    const i = h.findIndex(c => SYN[k].test(c));
    return i >= 0 ? i : undefined;
  };
  const date = find('date');
  const narration = find('narration');
  if (date === undefined || narration === undefined) return undefined;
  const map: ColumnMap = { date, narration, debit: find('debit'), credit: find('credit'), amount: find('amount'), type: find('type'), balance: find('balance'), ref: find('ref') };
  if (map.debit === undefined && map.credit === undefined && map.amount === undefined) return undefined;
  return map;
}

export function parseAmount(s: string | undefined): number {
  if (!s) return 0;
  const t = s.replace(/[₹$£€,\s]|INR|USD|GBP|EUR|Rs\.?/gi, '');
  if (!t || t === '-') return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const v = parseFloat(t.replace(/[()-]/g, ''));
  return isNaN(v) ? 0 : neg ? -v : v;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Decide day-first vs month-first from the whole column, then parse every date the same way. */
export function makeDateParser(samples: string[]): (s: string) => string | undefined {
  let dayFirst = true;
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) continue;
    if (+m[1] > 12) { dayFirst = true; break; }
    if (+m[2] > 12) { dayFirst = false; break; }
  }
  return (s: string) => {
    const t = s.trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (m) {
      const [a, b] = [+m[1], +m[2]];
      const [d, mo] = dayFirst ? [a, b] : [b, a];
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{2,4})$/);
    if (m && MONTHS[m[2].toLowerCase()]) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return undefined;
  };
}

export interface ImportResult {
  txns: Txn[];
  columns: ColumnMap;
  header: string[];
  skipped: number;
  currency: Currency;
}

export function importStatement(csvText: string): ImportResult {
  const rows = (Papa.parse<string[]>(csvText.trim(), { skipEmptyLines: true }).data as string[][]).map(r => r.map(c => (c ?? '').toString()));
  // Bank exports often start with account details; the table starts at the first row that looks like a header.
  const headerIdx = rows.findIndex(r => detectColumns(r) !== undefined);
  if (headerIdx < 0) throw new Error('Could not find the transaction table. Expected columns like Date, Narration/Description, Withdrawal/Debit, Deposit/Credit.');
  const header = rows[headerIdx];
  const columns = detectColumns(header)!;
  const body = rows.slice(headerIdx + 1);
  const parseDate = makeDateParser(body.map(r => r[columns.date] ?? ''));
  const head = csvText.slice(0, 4000);
  const currency: Currency = /₹|\bINR\b|\bRs\.?\s?\d/.test(head) ? 'INR' : /£|\bGBP\b/.test(head) ? 'GBP' : /€|\bEUR\b/.test(head) ? 'EUR' : 'USD';

  const txns: Txn[] = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[columns.date] ?? '');
    const narration = (r[columns.narration] ?? '').trim();
    if (!date || !narration) { skipped++; continue; }
    let out = columns.debit !== undefined ? Math.abs(parseAmount(r[columns.debit])) : 0;
    let inn = columns.credit !== undefined ? Math.abs(parseAmount(r[columns.credit])) : 0;
    if (columns.amount !== undefined && !out && !inn) {
      const a = parseAmount(r[columns.amount]);
      const ty = columns.type !== undefined ? (r[columns.type] ?? '').trim().toUpperCase() : '';
      if (ty.startsWith('D')) out = Math.abs(a);
      else if (ty.startsWith('C')) inn = Math.abs(a);
      else if (a < 0) out = -a;
      else inn = a;
    }
    if (!out && !inn) { skipped++; continue; }
    const p = parseNarration(narration);
    const direction = out ? 'out' : 'in';
    txns.push({
      id: txns.length + 1,
      date,
      narration,
      amount: out || inn,
      direction,
      balance: columns.balance !== undefined ? parseAmount(r[columns.balance]) : undefined,
      ref: columns.ref !== undefined ? (r[columns.ref] ?? '').trim() || p.ref : p.ref,
      rail: p.rail,
      counterparty: p.counterparty,
      counterpartyKey: counterpartyKey(p.counterparty, p.vpa),
      counterpartyKind: counterpartyKind(p.counterparty, p.rail, p.note),
      vpa: p.vpa,
      note: p.note,
      categorySource: 'none',
    });
  }
  if (!txns.length) throw new Error('No transactions found under the header row.');
  return { txns, columns, header, skipped, currency };
}
