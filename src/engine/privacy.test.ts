// What may leave the device, checked against the raw statement itself (see proof.ts).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/firebase', () => ({ cloudFirstModel: () => ({}), deviceModel: () => ({}) }));

import { maskedLine } from './cloud';
import { importStatement } from './csv';
import { rawFound, selfCheck, statementSecrets } from './proof';
import { isSafeNumber } from './safewords';
import { Vault } from './vault';

const FILES = [
  ...['cafe', 'hoa', 'rescue'].map(n => `public/samples/${n}.csv`),
  ...['dental', 'club', 'designer'].map(n => `eval/holdout/${n}.csv`),
  ...readdirSync('eval/formats').filter(f => f.endsWith('.csv')).map(f => `eval/formats/${f}`),
];

/** Every row of a statement as it would be sent in the worst case (no on-device model: each row goes out). */
function allLines(file: string) {
  const { txns, currency } = importStatement(readFileSync(file, 'utf8'));
  const vault = new Vault();
  for (const t of txns) if (t.counterparty && t.counterpartyKind !== 'NONE') vault.registerParty(t.counterparty, t.counterpartyKind);
  return { txns, lines: txns.map(t => `- ${maskedLine(t, vault, currency)}`), secrets: statementSecrets(txns) };
}

describe('nothing raw leaves', () => {
  it('no word or number of any statement appears in its masked lines, in any layout', () => {
    for (const file of FILES) {
      const { lines, secrets } = allLines(file);
      expect(secrets.size, file).toBeGreaterThan(5);
      const found = rawFound(lines.join('\n'), secrets);
      expect(found, `${file}: ${found.join(', ')}`).toEqual([]);
    }
  });

  it('a payee is always one placeholder, whatever kind of party it is', () => {
    for (const file of FILES) {
      for (const line of allLines(file).lines) {
        // date, direction, amount, rail, then nothing but an optional placeholder, its kind, a note and a category
        expect(line, file).toMatch(/^- \d{4}-\d{2}-\d{2} (OUT|IN) \S+ via [A-Z]+( \[[A-Z]+_\d+\] \((person|business|bank|government|self)\))?( note: "[^"]*")?( category: [A-Za-z ,&’-]+)?$/);
      }
    }
    const { txns, currency } = importStatement('Date,Description,Withdrawals,Deposits\n10/14/2026,ONLINE TRANSFER TO SAV XXXX4410,2000.00,\n10/20/2026,ACH DEBIT STATE DEPT OF REVENUE SALES TAX SEP,864.20,\n10/21/2026,WIRE IN FROM FIRST HARBOR BANK MEMO LOAN,,5000.00\n');
    const vault = new Vault();
    expect(txns.map(t => maskedLine(t, vault, currency))).toEqual([
      '2026-10-14 OUT $2,000.00 via TRANSFER [SELF_1] (self)',
      '2026-10-20 OUT $864.20 via ACH [GOVERNMENT_1] (government)',
      '2026-10-21 IN $5,000.00 via WIRE [BANK_1] (bank) note: "LOAN"',
    ]);
  });

  it('the tail of a card or account number never leaves; an invoice number does', () => {
    const v = new Vault();
    expect(v.maskNote('INV 2231').text).toBe('INV 2231');
    expect(v.maskNote('order 55281 unit 12 fy 2026').text).toBe('order 55281 unit 12 fy 2026');
    expect(v.maskNote('card 4471').text).toBe('card [WORD_1]');
    expect(v.maskNote('acct ending in 4410').text).not.toMatch(/4410/);
    expect(v.maskNote('from XXXX4410 and ...8812').text).not.toMatch(/4410|8812/);
    expect(v.maskNote('zip 77002').text).not.toMatch(/77002/);
    expect(v.maskNote('#4471').text).not.toMatch(/4471/);
    expect(isSafeNumber('2231', 'INV')).toBe(true);
    expect(isSafeNumber('2231', 'card')).toBe(false);
    expect(isSafeNumber('1234567', 'INV')).toBe(false);
  });

  it('an everyday word in a payee name does not turn into a person code elsewhere', () => {
    const v = new Vault();
    v.registerParty('CLUBSITE WEB MONTHLY', 'PERSON'); // mis-labelled on purpose
    expect(v.maskNote('MONTHLY SERVICE FEE').text).toBe('MONTHLY SERVICE FEE');
  });

  it('a payee mentioned in another row’s note is masked there too, and only as a whole word', () => {
    const v = new Vault();
    v.registerParty('ANN LEE', 'PERSON');
    v.registerParty('HARBORVIEW BAKERY SUPPLY', 'BUSINESS');
    expect(v.maskNote('annual fee paid via Harborview Bakery Supply for ann').text).toBe('annual fee paid via [BUSINESS_1] for [PERSON_1]');
  });

  it('the self-check finds a leak when there is one', () => {
    const { txns } = importStatement(readFileSync('public/samples/cafe.csv', 'utf8'));
    const secrets = statementSecrets(txns);
    expect(rawFound('- 2026-10-08 OUT $1,845.00 via ACH HARBORVIEW BAKERY SUPPLY (business) note: "INV 2231"', secrets)).toEqual(['harborview']);
    expect(rawFound('- 2026-10-06 OUT $2,000.00 via TRANSFER SAV XXXX4410 (self)', secrets).sort()).toEqual(['4410', 'sav', 'xxxx', 'xxxx4410']);
    expect(rawFound('- 2026-10-08 OUT $1,845.00 via ACH [BUSINESS_6] (business) note: "INV 2231" category: Purchases & suppliers', secrets)).toEqual([]);
    // The standing instructions are not statement content, so a word there is not a leak.
    expect(rawFound('You are a careful audit reviewer. Harborview.\n- 2026-10-08 OUT $1.00 via ACH', secrets)).toEqual([]);
  });

  it('the recorded runs pass the self-check: nothing from the statement in any request', () => {
    for (const id of ['cafe', 'hoa', 'rescue']) {
      const { snapshot } = JSON.parse(readFileSync(`public/recorded/${id}.json`, 'utf8'));
      const check = selfCheck(statementSecrets(snapshot.txns), snapshot.ledger);
      expect(check.requests, id).toBeGreaterThan(3);
      expect(check.searchedFor, id).toBeGreaterThan(30);
      expect(check.found, id).toEqual([]);
    }
  });
});
