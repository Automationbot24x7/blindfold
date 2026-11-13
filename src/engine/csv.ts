// Statement import: finds the transaction table in a bank's CSV export and normalises the rows.
// Banks agree on nothing: headers differ ("Posting Date", "Transaction Remarks", "Paid out"),
// some files have no header row at all, dates are day-first or month-first, amounts use a decimal
// point or a decimal comma. The importer works the layout out from the file itself and reports
// what it decided, so the person can check it. Nothing here uses a model or the network.
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

type Field = keyof ColumnMap;

/** Header names per field, in order of preference: the first one present in the file wins. */
const NAMES: Record<Field, string[]> = {
  date: ['date', 'transaction date', 'txn date', 'tran date', 'trans date', 'posting date', 'posted date', 'post date', 'date posted', 'booking date', 'effective date', 'value date', 'value dt', 'buchungstag', 'buchungsdatum', 'datum', 'fecha', 'date operation', 'valuta'],
  narration: ['description', 'transaction description', 'narration', 'particulars', 'transaction details', 'transaction remarks', 'remarks', 'memo', 'details', 'payee', 'name', 'merchant', 'counter party', 'counterparty', 'reference', 'verwendungszweck', 'buchungstext', 'libelle', 'concepto', 'descripcion', 'descrizione', 'omschrijving', 'text'],
  debit: ['withdrawal', 'withdrawals', 'withdrawal amt', 'withdrawal amount', 'debit', 'debits', 'debit amount', 'dr', 'dr amount', 'amount out', 'money out', 'paid out', 'out', 'payments', 'soll', 'debe', 'cargo'],
  credit: ['deposit', 'deposits', 'deposit amt', 'deposit amount', 'credit', 'credits', 'credit amount', 'cr', 'cr amount', 'amount in', 'money in', 'paid in', 'in', 'receipts', 'haben', 'haber', 'abono'],
  amount: ['amount', 'transaction amount', 'amt', 'betrag', 'montant', 'importe', 'importo', 'bedrag'],
  type: ['type', 'dr/cr', 'cr/dr', 'debit/credit', 'credit/debit', 'txn type', 'transaction type', 'dr cr', 'cr dr', 'credit debit indicator'],
  balance: ['balance', 'closing balance', 'running balance', 'available balance', 'running bal', 'ledger balance', 'bal', 'saldo', 'solde'],
  ref: ['chq/ref no', 'ref no', 'ref no/cheque no', 'reference no', 'reference number', 'cheque no', 'cheque number', 'chq no', 'check number', 'check no', 'check or slip #', 'check #', 'cheque #', 'ref'],
};

/** "Withdrawal Amt. (INR )" -> "withdrawal amt": lower case, no accents, no units, no punctuation. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9/#]+/g, ' ').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

export function detectColumns(header: string[]): ColumnMap | undefined {
  const h = header.map(norm);
  const find = (k: Field) => {
    for (const name of NAMES[k]) {
      const i = h.indexOf(name);
      if (i >= 0) return i;
    }
    return undefined;
  };
  const date = find('date');
  const narration = find('narration');
  if (date === undefined || narration === undefined || date === narration) return undefined;
  const map: ColumnMap = { date, narration, debit: find('debit'), credit: find('credit'), amount: find('amount'), type: find('type'), balance: find('balance'), ref: find('ref') };
  if (map.debit === undefined && map.credit === undefined && map.amount === undefined) return undefined;
  return map;
}

/** One amount cell to a signed number: "(45.00)", "-$45.00", "45.00-", "45.00 DR", "1.250,00" (decimal comma). */
export function parseAmount(s: string | undefined, decimalComma = false): number {
  const t = (s ?? '').trim();
  if (!t) return 0;
  let d = t.replace(/[^\d.,]/g, '');
  if (!/\d/.test(d)) return 0;
  d = decimalComma ? d.replace(/\./g, '').replace(',', '.') : d.replace(/,/g, '');
  const v = parseFloat(d);
  if (isNaN(v)) return 0;
  const neg = /^\(.*\)$/.test(t) || /^[^\d]*[-−–]/.test(t) || /[-−–]\s*$/.test(t) || /\bDR\.?\s*$/i.test(t);
  return neg ? -v : v;
}

/** Does this file write amounts with a decimal comma (1.250,00) rather than a decimal point (1,250.00)? */
export function usesDecimalComma(samples: string[]): boolean {
  let comma = 0, dot = 0;
  for (const s of samples) {
    const t = s.replace(/[^\d.,]/g, '');
    if (/,\d{1,2}$/.test(t)) comma++;
    else if (/\.\d{1,2}$/.test(t)) dot++;
  }
  return comma > dot;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/;

/**
 * 03/04/2026 is the 3rd of April in most of the world and March 4th in the US. Decide from the
 * whole column (a 13 or more can only be a day); if every date is ambiguous, go by the currency.
 */
export function dayComesFirst(samples: string[], monthFirstDefault = false): boolean {
  for (const s of samples) {
    const m = s.trim().match(NUMERIC_DATE);
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) return false;
  }
  return !monthFirstDefault;
}

/** Parses every date in a column the same way. Returns ISO yyyy-mm-dd, or undefined for a cell that is not a date. */
export function makeDateParser(samples: string[], monthFirstDefault = false): (s: string) => string | undefined {
  const dayFirst = dayComesFirst(samples, monthFirstDefault);
  const iso = (y: number, mo: number, d: number) => {
    const year = y < 100 ? 2000 + y : y;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && year >= 1990 && year <= 2099)) return undefined;
    if (new Date(Date.UTC(year, mo - 1, d)).getUTCMonth() !== mo - 1) return undefined; // 31 February
    return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  return (s: string) => {
    const t = s.trim();
    let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/); // 2026-11-03, with or without a time after it
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = t.match(NUMERIC_DATE); // 03/11/2026, 3.11.26
    if (m) return dayFirst ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
    m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s,-]+(\d{4}|\d{2})(?!\d)/); // 3 Nov 2026, 03-Nov-26
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})(?!\d)/); // Nov 3, 2026
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    m = t.match(/^(\d{4})(\d{2})(\d{2})$/); // 20261103
    if (m) return iso(+m[1], +m[2], +m[3]);
    return undefined;
  };
}

const looksLikeDate = (s: string) => makeDateParser([s])(s) !== undefined;
const looksLikeAmount = (s: string) => /^[-+(−–]?\s?[$£€₹]?\s?[-−–]?\d[\d.,' ]*\)?\s?(CR|DR)?\.?-?$/i.test(s.trim()) && !looksLikeDate(s);

/**
 * A file with no header row (some banks export only the rows): tell the columns apart by what
 * is in them. The date column is full of dates, the description is the long text, and the
 * amount is the fullest column of numbers.
 */
export function guessColumns(rows: string[][]): ColumnMap | undefined {
  // Start at the first row that holds a date: whatever is above it (titles, an unknown header) is not data.
  const first = rows.findIndex(r => r.some(looksLikeDate));
  if (first < 0) return undefined;
  const sample = rows.slice(first, first + 80);
  const width = Math.max(...sample.map(r => r.length));
  const stats = Array.from({ length: width }, (_, c) => {
    const cells = sample.map(r => (r[c] ?? '').trim()).filter(Boolean);
    const share = (test: (s: string) => boolean) => (cells.length ? cells.filter(test).length / cells.length : 0);
    return {
      c, fill: cells.length / sample.length, dates: share(looksLikeDate), amounts: share(looksLikeAmount),
      text: share(x => /[A-Za-z]{3,}/.test(x)), len: cells.reduce((s, x) => s + x.length, 0) / Math.max(1, cells.length),
    };
  });
  const date = stats.find(s => s.fill >= 0.8 && s.dates >= 0.8);
  const narration = stats.filter(s => s !== date && s.fill >= 0.5 && s.text >= 0.6).sort((a, b) => b.len - a.len)[0];
  if (!date || !narration) return undefined;
  const numbers = stats.filter(s => s !== date && s !== narration && s.fill > 0 && s.amounts >= 0.9).sort((a, b) => b.fill - a.fill);
  if (!numbers.length) return undefined;
  // Two half-full number columns that together fill the rows are "money out" and "money in", in that order.
  const [a, b] = [...numbers.slice(0, 2)].sort((x, y) => x.c - y.c);
  if (b && a.fill < 0.95 && b.fill < 0.95 && a.fill + b.fill >= 0.9 && a.fill + b.fill <= 1.1) return { date: date.c, narration: narration.c, debit: a.c, credit: b.c };
  return { date: date.c, narration: narration.c, amount: numbers[0].c };
}

/** For the column picker: whatever can be recognised on its own (the dates, the money), even when the whole layout cannot. */
export function suggestColumns(rows: string[][]): Partial<ColumnMap> {
  const full = guessColumns(rows);
  if (full) return full;
  const first = Math.max(0, rows.findIndex(r => r.some(looksLikeDate)));
  const sample = rows.slice(first, first + 80);
  const width = Math.max(0, ...sample.map(r => r.length));
  const cells = (c: number) => sample.map(r => (r[c] ?? '').trim()).filter(Boolean);
  const out: Partial<ColumnMap> = {};
  for (let c = 0; c < width && out.date === undefined; c++) {
    const v = cells(c);
    if (v.length && v.filter(looksLikeDate).length / v.length >= 0.8) out.date = c;
  }
  // Money is written with cents; a bare counter (1, 2, 3) is not money.
  const money = Array.from({ length: width }, (_, c) => c).filter(c => c !== out.date && cells(c).length > 0 && cells(c).every(looksLikeAmount) && cells(c).some(x => /[.,]\d{2}\D*$/.test(x)));
  if (money.length === 1) out.amount = money[0];
  else if (money.length >= 2) { out.debit = money[0]; out.credit = money[1]; }
  return out;
}

const DR = /^(d|dr|debit|dbit|db|withdrawal)\.?$/i;
const CR = /^(c|cr|credit|crdt|deposit)\.?$/i;

function detectCurrency(csvText: string): Currency {
  const head = csvText.slice(0, 6000);
  if (/₹|\bINR\b|\bRs\.?\s?\d|\b(UPI|NEFT|IMPS|RTGS|IFSC)\b/.test(head)) return 'INR';
  if (/£|\bGBP\b|\bsort code\b/i.test(head)) return 'GBP';
  if (/€|\bEUR\b|\b(SEPA|IBAN)\b/.test(head)) return 'EUR';
  return 'USD';
}

export const MAX_ROWS = 3000;

export interface ImportOptions {
  columns?: ColumnMap; // set by hand when the layout could not be worked out
  currency?: Currency;
}

export interface ImportResult {
  txns: Txn[];
  columns: ColumnMap;
  header: string[]; // empty when the file has no header row
  skipped: number;
  currency: Currency;
  from: string; // first and last date, ISO
  to: string;
  notes: string[]; // how the file was read, in plain words
}

/** Thrown when the transaction table cannot be found; carries the parsed rows so the user can point at the columns. */
export class LayoutError extends Error {
  constructor(message: string, readonly rows: string[][]) { super(message); }
}

/** The file as rows of cells (commas, semicolons or tabs; quoted cells; blank lines dropped). */
export function tableOf(csvText: string): string[][] {
  const text = csvText.replace(/^﻿/, '').trim();
  return (Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data as string[][]).map(r => r.map(c => (c ?? '').toString().trim()));
}

export function importStatement(csvText: string, opts: ImportOptions = {}): ImportResult {
  const rows = tableOf(csvText);
  const notes: string[] = [];
  let columns: ColumnMap | undefined = opts.columns;
  let header: string[] = [];
  let body = rows;
  // Columns pointed out by hand: a first row with no date in the date column is the header.
  if (columns && rows.length && makeDateParser([])(rows[0][columns.date] ?? '') === undefined) {
    header = rows[0];
    body = rows.slice(1);
  }
  if (!columns) {
    // Bank exports often start with account details; the table starts at the first row that looks like a header.
    const headerIdx = rows.slice(0, 60).findIndex(r => detectColumns(r) !== undefined);
    if (headerIdx >= 0) {
      header = rows[headerIdx];
      columns = detectColumns(header)!;
      body = rows.slice(headerIdx + 1);
    } else {
      columns = guessColumns(rows);
      if (columns) notes.push('This file has no header row, so the columns were told apart by what is in them.');
    }
  }
  if (!columns) throw new LayoutError('Could not find the date, description and amount columns in this file.', rows);
  const col = columns;

  const currency = opts.currency ?? detectCurrency(csvText);
  const dateCells = body.map(r => r[col.date] ?? '');
  const parseDate = makeDateParser(dateCells, currency === 'USD');
  if (dateCells.some(c => NUMERIC_DATE.test(c.trim()))) notes.push(`Dates were read as ${dayComesFirst(dateCells, currency === 'USD') ? 'day/month/year' : 'month/day/year'}.`);
  const moneyCells = body.flatMap(r => [col.debit, col.credit, col.amount].map(c => (c === undefined ? '' : r[c] ?? '')).filter(Boolean));
  const decimalComma = usesDecimalComma(moneyCells);
  const amount = (s: string | undefined) => parseAmount(s, decimalComma);
  // A debit/credit column is only believed if every value in it says debit or credit ("ACH_DEBIT", "CHECK_PAID" do not).
  const typeCol = col.type !== undefined && body.some(r => (r[col.type!] ?? '').trim()) && body.every(r => { const v = (r[col.type!] ?? '').trim(); return !v || DR.test(v) || CR.test(v); })
    ? col.type : undefined;

  const txns: Txn[] = [];
  let skipped = 0, positiveOnly = true;
  for (const r of body) {
    const date = parseDate(r[col.date] ?? '');
    const narration = (r[col.narration] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || !narration) { skipped++; continue; }
    let out = col.debit !== undefined ? Math.abs(amount(r[col.debit])) : 0;
    let inn = col.credit !== undefined ? Math.abs(amount(r[col.credit])) : 0;
    if (col.amount !== undefined && !out && !inn) {
      const a = amount(r[col.amount]);
      const ty = typeCol !== undefined ? (r[typeCol] ?? '').trim() : '';
      if (a < 0) positiveOnly = false;
      if (ty && DR.test(ty)) out = Math.abs(a);
      else if (ty && CR.test(ty)) inn = Math.abs(a);
      else if (a < 0) out = -a;
      else inn = a;
    }
    if (!out && !inn) { skipped++; continue; }
    if (txns.length >= MAX_ROWS) { skipped++; continue; }
    const p = parseNarration(narration);
    txns.push({
      id: txns.length + 1,
      date,
      narration,
      amount: out || inn,
      direction: out ? 'out' : 'in',
      balance: col.balance !== undefined && (r[col.balance] ?? '').trim() ? amount(r[col.balance]) : undefined,
      ref: col.ref !== undefined ? (r[col.ref] ?? '').trim() || p.ref : p.ref,
      rail: p.rail,
      counterparty: p.counterparty,
      counterpartyKey: counterpartyKey(p.counterparty, p.vpa),
      counterpartyKind: counterpartyKind(p.counterparty, p.rail, p.note),
      vpa: p.vpa,
      note: p.note,
      categorySource: 'none',
    });
  }
  if (!txns.length) {
    if (opts.columns) throw new Error('No transactions could be read with those columns. Check that the date and amount columns are the right ones.');
    throw new LayoutError('No transactions could be read from this file.', rows);
  }
  if (txns.length >= MAX_ROWS) notes.push(`Only the first ${MAX_ROWS.toLocaleString('en-US')} transactions were read.`);
  if (col.amount !== undefined && col.debit === undefined && col.credit === undefined && typeCol === undefined && positiveOnly) {
    notes.push('Every amount in this file is positive and nothing marks debits, so all rows were read as money in. If that is wrong, export the statement with separate debit and credit columns.');
  }
  if (decimalComma) notes.push('Amounts were read with a decimal comma (1.250,00).');
  const dates = txns.map(t => t.date).sort();
  return { txns, columns: col, header, skipped, currency, from: dates[0], to: dates[dates.length - 1], notes };
}
