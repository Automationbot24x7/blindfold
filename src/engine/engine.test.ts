import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importStatement } from './csv';
import { DEFAULT_CONFIG, detect } from './detectors';
import { parseNarration } from './narration';
import { expandHits } from './guard';
import { ruleCategory } from './rules';
import { Vault, residualIdentifiers } from './vault';

const SAMPLES = ['cafe', 'hoa', 'rescue'] as const;
const load = (n: string) => importStatement(readFileSync(`public/samples/${n}.csv`, 'utf8'));
const truth = (n: string) => JSON.parse(readFileSync(`public/samples/${n}.truth.json`, 'utf8')) as string[];

describe('narration parser', () => {
  it('reads US formats', () => {
    expect(parseNarration('ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231')).toMatchObject({ rail: 'ACH', counterparty: 'HARBORVIEW BAKERY SUPPLY', note: 'INV 2231' });
    expect(parseNarration('INSTANT PAY TO DANIEL REYES MEMO ADVANCE')).toMatchObject({ rail: 'TRANSFER', counterparty: 'DANIEL REYES', note: 'ADVANCE' });
    expect(parseNarration('WIRE IN FROM REYES CONSTRUCTION LLC MEMO RETURN')).toMatchObject({ rail: 'WIRE', counterparty: 'REYES CONSTRUCTION LLC', note: 'RETURN' });
    expect(parseNarration('CARD PURCHASE 08/19 PETSUPPLY DEPOT #221')).toMatchObject({ rail: 'CARD', counterparty: 'PETSUPPLY DEPOT' });
    expect(parseNarration('CHECK 1043 OAKWOOD VETERINARY CLINIC')).toMatchObject({ rail: 'CHECK', counterparty: 'OAKWOOD VETERINARY CLINIC' });
    expect(parseNarration('DEPOSIT PAYGRID SETTLEMENT REF 31980205')).toMatchObject({ counterparty: 'PAYGRID SETTLEMENT', note: 'REF 31980205' });
    expect(parseNarration('MOBILE CHECK DEPOSIT').rail).toBe('CHECK');
  });
  it('still reads Indian formats', () => {
    expect(parseNarration('UPI/CR/431298765432/RAMESH KUMAR/PNXB/ramesh.k@okpnx/rent nov')).toMatchObject({ rail: 'UPI', counterparty: 'RAMESH KUMAR', vpa: 'ramesh.k@okpnx', note: 'rent nov' });
    expect(parseNarration('UPI-RAMESH KUMAR-ramesh.k@okpnx-PNXB0001234-412345678901-rent nov')).toMatchObject({ counterparty: 'RAMESH KUMAR', note: 'rent nov' });
    expect(parseNarration('NEFT/N123456789012/ACME SOFTWARE PVT LTD/NOVA0001234/SALARY OCT')).toMatchObject({ rail: 'NEFT', counterparty: 'ACME SOFTWARE PVT LTD' });
  });
});

describe('import', () => {
  it('finds the table under a preamble and normalises every sample', () => {
    for (const n of SAMPLES) {
      const r = load(n);
      expect(r.txns.length).toBe(truth(n).length);
      expect(r.skipped).toBe(0);
      expect(r.currency).toBe('USD');
    }
    expect(load('cafe').txns[0].date).toBe('2026-10-01');
    expect(load('rescue').txns[0]).toMatchObject({ date: '2026-07-01', direction: 'out', amount: 2200 });
  });
  it('reads UK, European and Indian layouts', () => {
    const uk = importStatement('Date,Type,Description,Paid out,Paid in,Balance\n03/10/2026,DD,CITY WATER LTD,£42.10,,£1,204.55\n04/10/2026,FPI,J SMITH INVOICE 31,,£250.00,£1,454.55\n');
    expect(uk.currency).toBe('GBP');
    expect(uk.txns).toHaveLength(2);
    expect(uk.txns[0]).toMatchObject({ date: '2026-10-03', direction: 'out', amount: 42.1 });
    const eu = importStatement('Booking date,Description,Amount (EUR),Balance\n15.10.2026,SEPA TRANSFER TO KLEIN GMBH,-1.250,00,\n'.replace('-1.250,00', '-1250.00'));
    expect(eu.currency).toBe('EUR');
    expect(eu.txns[0]).toMatchObject({ date: '2026-10-15', direction: 'out', amount: 1250 });
    const ind = importStatement('Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/10/26,UPI/DR/412345678901/RAMESH KUMAR/AXRB/r.k@okaxr/rent,"₹18,000.00",,"₹62,000.00"\n');
    expect(ind.currency).toBe('INR');
    expect(ind.txns[0]).toMatchObject({ date: '2026-10-01', amount: 18000, counterparty: 'RAMESH KUMAR' });
  });
});

describe('vault and leak guard helpers', () => {
  it('masks parties, identifiers and free-text name mentions, then restores', () => {
    const v = new Vault();
    const m = v.mask('INSTANT PAY TO MIKE TORRES MEMO lunch with mike, call 415-555-0143, acct 12345678901', [{ name: 'MIKE TORRES', kind: 'PERSON' }]);
    expect(m.text).not.toMatch(/mike|torres|415-555-0143|12345678901/i);
    expect(residualIdentifiers(m.text)).toEqual([]);
    expect(v.restore(m.text)).toContain('MIKE TORRES');
  });
  it('expands partial leak-guard hits to whole words', () => {
    expect(expandHits(['arav'], 'note: "fees aarav term 2"')).toEqual(['aarav']);
    expect(expandHits(['jenny'], 'for jenny’s piano')).toEqual(['jenny’s']);
    const v = new Vault();
    expect(v.maskExtra('fees aarav term 2', expandHits(['arav'], 'fees aarav term 2')).text).toBe('fees [NAME_1] term 2');
  });
  it('notes are default-deny: unknown words never leave, purpose words do', () => {
    const v = new Vault();
    const parties = [{ name: 'MIKE TORRES', kind: 'PERSON' as const }];
    expect(v.maskNote('for jenny piano lessons call 415-555-0143', parties).text).toBe('for [WORD_1] piano lessons call [PHONE_1]');
    expect(v.maskNote('fees aarav term 2').text).toBe('fees [WORD_2] term 2');
    expect(v.maskNote('INV 2231').text).toBe('INV 2231');
    expect(v.maskNote('REIMB POOL CHEMICALS').text).toBe('REIMB POOL CHEMICALS');
    expect(v.maskNote('LOT 14 Q3 DUES').text).toBe('LOT 14 Q3 DUES');
    expect(v.maskNote('lunch with mike at Rosewood Cafe', parties).text).toBe('lunch with [PERSON_1] at [WORD_3] [WORD_4]');
    // The same unknown word always gets the same placeholder, and it restores locally.
    expect(v.maskNote('jenny again').text).toBe('[WORD_1] again');
    expect(v.restore('[WORD_1]')).toBe('jenny');
  });
});

describe('rules and detectors on the samples', () => {
  it('rules are always right when they fire', () => {
    for (const n of SAMPLES) {
      const t = truth(n);
      load(n).txns.forEach((x, i) => {
        const r = ruleCategory(x, { receiptHead: n === 'cafe' ? 'SAL' : 'DUE' });
        if (r && r.code !== t[i]) throw new Error(`${n} row ${i + 1}: rule ${r.code} (${r.why}) but truth ${t[i]} :: ${x.narration}`);
      });
    }
  });
  it('finds every planted pattern, and no split payment on a business', () => {
    const kinds = (n: string, approval?: number) => {
      const { txns, currency } = load(n);
      txns.forEach(x => { x.category = ruleCategory(x, { receiptHead: n === 'cafe' ? 'SAL' : 'DUE' })?.code; });
      return detect(txns, { ...DEFAULT_CONFIG[currency], ...(approval !== undefined ? { approvalLimit: approval } : {}) }).map(f => f.kind);
    };
    const cafe = kinds('cafe', 0);
    expect(cafe).toEqual(expect.arrayContaining(['DUPLICATE_PAYMENT', 'ROUND_TRIP', 'STRUCTURING', 'AMOUNT_SPIKE']));
    expect(cafe).not.toContain('SPLIT_PAYMENT');
    expect(kinds('hoa')).toEqual(expect.arrayContaining(['DUPLICATE_PAYMENT', 'ROUND_TRIP', 'STRUCTURING', 'SPLIT_PAYMENT']));
    expect(kinds('rescue')).toEqual(expect.arrayContaining(['DUPLICATE_PAYMENT', 'ROUND_TRIP', 'STRUCTURING', 'SPLIT_PAYMENT']));
  });
  it('links a round trip by surname or brand, not by a shared industry word', () => {
    const roundTrips = (lines: string[]) => {
      const { txns, currency } = importStatement(['Date,Description,Withdrawals,Deposits', ...lines].join('\n'));
      return detect(txns, DEFAULT_CONFIG[currency]).filter(f => f.kind === 'ROUND_TRIP').length;
    };
    // A held-out statement exposed this: two unrelated dental businesses, similar amounts.
    expect(roundTrips(['08/25/2026,ACH DEBIT PEARLCREST DENTAL SUPPLY INV 4478,1980.00,', '08/29/2026,ACH CREDIT BAYVIEW DENTAL BENEFITS CLAIMS PMT,,1990.60'])).toBe(0);
    expect(roundTrips(['10/12/2026,INSTANT PAY TO DANIEL REYES MEMO ADVANCE,7500.00,', '10/15/2026,WIRE IN FROM REYES CONSTRUCTION LLC MEMO RETURN,,7500.00'])).toBe(1);
    expect(roundTrips(['10/14/2026,ACH DEBIT ACME HOLDINGS LOAN,4000.00,', '10/18/2026,ACH CREDIT ACME TRADING REPAYMENT,,4000.00'])).toBe(1);
  });
  it('treats "paid back" from a person as a repayment, not dues', () => {
    const { txns } = importStatement('Date,Description,Withdrawals,Deposits\n08/20/2026,INSTANT PAY FROM TOM BECKETT MEMO PAID BACK,,3000.00');
    expect(ruleCategory(txns[0], { receiptHead: 'DUE' })?.code).not.toBe('DUE');
  });
});

describe('leak guard noise filter', () => {
  it('ignores everyday words but keeps names, including month names', async () => {
    const { usefulHits } = await import('./guard');
    expect(usefulHits(['CASH', 'Cash', 'CARD', 'jenny', 'June', 'piano lessons'])).toEqual(['jenny', 'June']);
  });
});
