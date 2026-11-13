// The importer against the layouts real banks export (made-up data, see eval/formats).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guessColumns, importStatement, LayoutError, makeDateParser, parseAmount, suggestColumns, tableOf } from './csv';
import { DEFAULT_CONFIG, detect } from './detectors';
import { counterpartyKind, parseNarration } from './narration';
import { ruleCategory } from './rules';

const load = (n: string) => importStatement(readFileSync(`eval/formats/${n}.csv`, 'utf8'));
const row = (r: ReturnType<typeof load>, needle: string) => r.txns.find(t => t.narration.includes(needle))!;

describe('bank export layouts', () => {
  it('one signed amount column, with a Type column that does not say debit or credit', () => {
    const r = load('us-signed-amount');
    expect(r.txns).toHaveLength(10);
    expect(r.currency).toBe('USD');
    // "Details" holds DEBIT/CREDIT; the text to read is in "Description".
    expect(r.txns.every(t => !/^(DEBIT|CREDIT|CHECK|DSLIP)$/.test(t.narration))).toBe(true);
    // CHECK_PAID starts with a C and DEPOSIT with a D: the sign decides, not the first letter.
    expect(row(r, 'CHECK 1042')).toMatchObject({ direction: 'out', amount: 1200, rail: 'CHECK', counterparty: '', ref: '1042' });
    expect(row(r, 'DEPOSIT  ID NUMBER'.replace('  ', ' '))).toMatchObject({ direction: 'in', amount: 9800, counterparty: '' });
    expect(row(r, 'ORIG CO NAME')).toMatchObject({ direction: 'out', rail: 'ACH', counterparty: 'PAYDAY SVC', note: 'TAX' });
    expect(row(r, 'MARIA GONZALEZ')).toMatchObject({ direction: 'in', counterparty: 'MARIA GONZALEZ', counterpartyKind: 'PERSON' });
    expect(row(r, 'Online Transfer to SAV')).toMatchObject({ counterparty: 'SAV ...4410', counterpartyKind: 'SELF' });
    expect(row(r, 'NORTHWIND COFFEE')).toMatchObject({ counterparty: 'NORTHWIND COFFEE STORE', counterpartyKind: 'BUSINESS' });
    expect(row(r, 'REMOTE ONLINE DEPOSIT')).toMatchObject({ rail: 'CHECK', counterparty: '' });
    // Two equal transfers to the same person six days apart are worth a question.
    const kinds = detect(r.txns, DEFAULT_CONFIG.USD).map(f => f.title);
    expect(kinds).toEqual(['$600.00 paid to Tom Becket twice in 6 days']);
  });

  it('a summary block above the table', () => {
    const r = load('us-summary-on-top');
    expect(r.txns).toHaveLength(8);
    expect(r.skipped).toBe(1); // the "Beginning balance" line has no amount
    expect(r.txns[0]).toMatchObject({ date: '2026-10-02', direction: 'out', amount: 450, counterparty: 'SAVANNAH JONES', balance: 11550 });
    expect(row(r, 'CHECKCARD')).toMatchObject({ rail: 'CARD', counterparty: 'CANYON OIL' });
    expect(row(r, 'WIRE TYPE')).toMatchObject({ rail: 'WIRE', direction: 'in', counterparty: 'REYES CONSTRUCTION LLC' });
    expect(row(r, 'transfer to CHK')).toMatchObject({ counterparty: 'CHK 8812', counterpartyKind: 'SELF' });
    expect(row(r, 'ATM')).toMatchObject({ rail: 'ATM', counterparty: '', note: '' });
    // A person called Savannah is not a savings account, and a consultant called Revenue is not the tax office.
    expect(row(r, 'TRANSFER TO SAVANNAH')).toMatchObject({ counterparty: 'SAVANNAH JONES', counterpartyKind: 'PERSON', note: 'birthday gift' });
    expect(row(r, 'JOHN REVENUE')).toMatchObject({ counterparty: 'JOHN REVENUE CONSULTING', counterpartyKind: 'BUSINESS', note: 'INV 88' });
    expect(ruleCategory(row(r, 'JOHN REVENUE'))?.code).not.toBe('TAX');
  });

  it('no header row at all', () => {
    const r = load('us-no-header');
    expect(r.txns).toHaveLength(4);
    expect(r.header).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/no header row/);
    expect(r.txns[0]).toMatchObject({ date: '2026-11-03', direction: 'out', amount: 45, rail: 'CARD', counterparty: 'RIVR Mktp', counterpartyKind: 'BUSINESS' });
    expect(row(r, 'PRIYA NAIR')).toMatchObject({ direction: 'in', amount: 1500, counterparty: 'PRIYA NAIR', note: 'RENT NOV' });
    expect(row(r, 'CHECK # 1043')).toMatchObject({ direction: 'out', rail: 'CHECK', counterparty: '' });
    expect(row(r, 'PIXELFORGE')).toMatchObject({ counterparty: 'PIXELFORGE CREATIVE SUITE' });
  });

  it('separate debit and credit columns, day-first dates', () => {
    const r = load('uk-debit-credit');
    expect(r.currency).toBe('GBP');
    expect(r.txns.map(t => t.date)).toEqual(['2026-11-03', '2026-11-02', '2026-11-02', '2026-11-13']);
    expect(r.txns.map(t => t.direction)).toEqual(['out', 'out', 'in', 'out']);
    expect(row(r, 'PATEL')).toMatchObject({ counterpartyKind: 'PERSON' });
  });

  it('withdrawal and deposit columns with the currency in the header', () => {
    const r = load('in-withdrawal-deposit');
    expect(r.currency).toBe('INR');
    expect(r.txns).toHaveLength(3);
    expect(r.txns[0]).toMatchObject({ date: '2026-11-01', direction: 'out', amount: 18000, rail: 'UPI', counterparty: 'RAMESH KUMAR' });
    expect(r.txns[1]).toMatchObject({ direction: 'in', amount: 85000, counterparty: 'ACME SOFTWARE PVT LTD' });
    expect(r.txns[2]).toMatchObject({ counterparty: 'Skynet Postpaid' });
  });

  it('dates written out or with a time, and a negative in brackets', () => {
    const r = load('long-dates');
    expect(r.txns.map(t => t.date)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(r.txns[3]).toMatchObject({ direction: 'out', amount: 120.5 });
  });

  it('semicolons and a decimal comma', () => {
    const r = load('eu-semicolon');
    expect(r.currency).toBe('EUR');
    expect(r.txns[0]).toMatchObject({ date: '2026-11-03', direction: 'out', amount: 1250 });
    expect(r.txns[1]).toMatchObject({ direction: 'in', amount: 650 });
    expect(r.notes.join(' ')).toMatch(/decimal comma/);
  });

  it('says so when it cannot find the table, and reads it once the columns are pointed out', () => {
    const csv = 'When,What happened,How much\n03/11/2026,Paid the plumber,-250.00\n14/11/2026,Rent received,650.00\n';
    // Without a usable header the columns are still told apart by their contents.
    expect(importStatement(csv).txns).toHaveLength(2);
    const odd = 'Notes about this file\nNothing else here\n';
    expect(() => importStatement(odd)).toThrow(LayoutError);
    try { importStatement(odd); } catch (e) { expect((e as LayoutError).rows).toHaveLength(2); }
    const manual = importStatement(csv, { columns: { date: 0, narration: 1, amount: 2 }, currency: 'GBP' });
    expect(manual.txns.map(t => [t.date, t.direction, t.amount])).toEqual([['2026-11-03', 'out', 250], ['2026-11-14', 'in', 650]]);
  });

  it('warns when nothing in the file says which rows are money out', () => {
    const r = importStatement('Date,Description,Amount\n11/03/2026,CARD PURCHASE 11/02 PETSUPPLY DEPOT #221,44.10\n11/14/2026,ACH DEBIT CITY POWER UTIL PMT,120.50\n');
    expect(r.notes.join(' ')).toMatch(/all rows were read as money in/);
  });
});

describe('amounts and dates', () => {
  it('reads the ways banks write a negative', () => {
    expect(parseAmount('(45.00)')).toBe(-45);
    expect(parseAmount('-$45.00')).toBe(-45);
    expect(parseAmount('$-45.00')).toBe(-45);
    expect(parseAmount('45.00-')).toBe(-45);
    expect(parseAmount('45.00 DR')).toBe(-45);
    expect(parseAmount('1,200.00 CR')).toBe(1200);
    expect(parseAmount('₹1,84,500.50')).toBe(184500.5);
    expect(parseAmount('1.250,00', true)).toBe(1250);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('-')).toBe(0);
  });
  it('an ambiguous date goes by the currency; a 13 settles it', () => {
    expect(makeDateParser(['03/04/2026'], true)('03/04/2026')).toBe('2026-03-04'); // US
    expect(makeDateParser(['03/04/2026'], false)('03/04/2026')).toBe('2026-04-03'); // elsewhere
    expect(makeDateParser(['03/04/2026', '25/04/2026'], true)('03/04/2026')).toBe('2026-04-03');
    expect(makeDateParser([])('31/02/2026')).toBeUndefined(); // no such day
    expect(makeDateParser([])('Total')).toBeUndefined();
    expect(makeDateParser([])('45/45/2026')).toBeUndefined();
  });
  it('tells columns apart by their contents', () => {
    const rows = tableOf('"11/03/2026","-45.00","*","","CARD PURCHASE"\n"11/02/2026","1500.00","*","1043","CHECK # 1043"\n');
    expect(guessColumns(rows)).toEqual({ date: 0, narration: 4, amount: 1 });
  });
  it('when the layout cannot be worked out, the dates and the money are still suggested', () => {
    const rows = tableOf('Ref;When;Code;Paid;Got\n1;03/11/2026;A1;250.00;\n2;14/11/2026;B2;;650.00\n3;15/11/2026;C3;40.00;\n');
    expect(guessColumns(rows)).toBeUndefined(); // "A1" is not a description anyone could recognise
    expect(suggestColumns(rows)).toEqual({ date: 1, debit: 3, credit: 4 });
    const read = importStatement('Ref;When;Code;Paid;Got\n1;03/11/2026;A1;250.00;\n2;14/11/2026;B2;;650.00\n', { columns: { date: 1, narration: 2, debit: 3, credit: 4 } });
    expect(read.header).toEqual(['Ref', 'When', 'Code', 'Paid', 'Got']);
    expect(read.skipped).toBe(0);
    expect(read.txns.map(t => [t.direction, t.amount])).toEqual([['out', 250], ['in', 650]]);
  });
});

describe('who is who', () => {
  it('software, utilities and abbreviations are not people', () => {
    expect(counterpartyKind('CLUBSITE WEB MONTHLY', 'CARD')).toBe('BUSINESS');
    expect(counterpartyKind('VALLEY ELECTRIC', 'ACH')).toBe('BUSINESS');
    expect(counterpartyKind('RIVR Mktp', 'CARD')).toBe('BUSINESS');
    expect(counterpartyKind('DANIEL REYES', 'TRANSFER')).toBe('PERSON');
    expect(counterpartyKind('MRS A PATEL RENT NOV', 'OTHER')).toBe('PERSON');
  });
  it('only a named own account is an own-account transfer', () => {
    expect(counterpartyKind('SAV XXXX4410', 'TRANSFER')).toBe('SELF');
    expect(counterpartyKind('SAVANNAH JONES', 'TRANSFER', 'to savings')).toBe('PERSON');
    expect(parseNarration('TRANSFER TO SAVANNAH JONES memo to savings').counterparty).toBe('SAVANNAH JONES');
  });
  it('equal transfers to your own savings are not a double payment, and a weekly wage is not one either', () => {
    const run = (lines: string[]) => {
      const { txns, currency } = importStatement(['Date,Description,Withdrawals,Deposits', ...lines].join('\n'));
      return detect(txns, DEFAULT_CONFIG[currency]).filter(f => f.kind === 'DUPLICATE_PAYMENT').length;
    };
    expect(run(['10/14/2026,ONLINE TRANSFER TO SAV XXXX4410,2000.00,', '10/16/2026,ONLINE TRANSFER TO SAV XXXX4410,2000.00,'])).toBe(0);
    expect(run(['10/02/2026,INSTANT PAY TO TOM BECKET MEMO WAGES,600.00,', '10/09/2026,INSTANT PAY TO TOM BECKET MEMO WAGES,600.00,', '10/16/2026,INSTANT PAY TO TOM BECKET MEMO WAGES,600.00,', '10/23/2026,INSTANT PAY TO TOM BECKET MEMO WAGES,600.00,'])).toBe(0);
    // The same invoice paid twice is still caught, however regular the supplier is.
    expect(run(['10/02/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231,1845.00,', '10/09/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231,1845.00,', '10/16/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2290,1845.00,'])).toBe(1);
    expect(run(['10/14/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231,1845.00,', '10/15/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231,1845.00,'])).toBe(1);
  });
});
