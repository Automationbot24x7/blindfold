// The whole audit, start to finish, with stand-in models: what leaves, what happens when a step
// fails, and that the limits hold. The stand-ins answer in the same JSON shapes as the real models.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  cloudPrompts: [] as string[],
  devicePrompts: [] as string[],
  cloud: (_text: string): string => '',
  device: (_text: string): string => '',
}));

vi.mock('../lib/firebase', () => {
  const reply = (text: string, inferenceSource: string) => ({ response: { text: () => text, inferenceSource } });
  return {
    cloudFirstModel: () => ({ generateContent: async (text: string) => { fake.cloudPrompts.push(text); return reply(fake.cloud(text), 'in_cloud'); } }),
    deviceModel: () => ({ generateContent: async (text: string) => { fake.devicePrompts.push(text); return reply(fake.device(text), 'on_device'); } }),
  };
});

import { importStatement } from './csv';
import { DEFAULT_CONFIG } from './detectors';
import { Audit, type AuditSnapshot } from './pipeline';
import { selfCheck, statementSecrets } from './proof';

const labels = (text: string, code: string) => JSON.stringify(Object.fromEntries((text.match(/^r\d+(?=: )/gm) ?? []).map(k => [k, code])));
const review = '{"verdict":"NEEDS_EXPLANATION","explanation":"[BUSINESS_1] was paid twice.","clientQuestion":"Was the second payment to [BUSINESS_1] a mistake?"}';
const goodCloud = (text: string) => (text.startsWith('Label each') ? labels(text, 'OTH') : review);
const goodDevice = (text: string) => (text.startsWith('You label') ? labels(text, 'UNS') : text.startsWith('This text is about') ? '{"leaks":[]}' : review);

async function audit(csv: string, o: { device: boolean; maxLabelRequests?: number; maxReviews?: number }): Promise<AuditSnapshot> {
  const { txns, currency } = importStatement(csv);
  const a = new Audit(txns, {
    currency, context: 'a small independent café', config: { ...DEFAULT_CONFIG[currency], approvalLimit: 0 },
    cloudModel: 'test-model', deviceBatchSize: 12, deviceAvailable: o.device, receiptHead: 'SAL',
    maxLabelRequests: o.maxLabelRequests, maxReviews: o.maxReviews, onUpdate: () => {},
  });
  await a.run();
  return a.snapshot;
}

const cafe = readFileSync('public/samples/cafe.csv', 'utf8');
/** Forty suppliers that no rule recognises (three label requests' worth), plus one invoice paid twice. */
const forty = [
  'Date,Description,Withdrawals,Deposits',
  ...Array.from({ length: 40 }, (_, i) => `10/${String(1 + (i % 28)).padStart(2, '0')}/2026,ACH DEBIT ZORB${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(75 + Math.floor(i / 26))} TRADING INV ${3000 + i},${(100 + i * 7).toFixed(2)},`),
  '10/14/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231,1845.00,',
  '10/15/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231,1845.00,',
].join('\n');
const check = (s: AuditSnapshot) => selfCheck(statementSecrets(s.txns), s.ledger);
const labelRequests = (s: AuditSnapshot) => s.ledger.filter(l => l.purpose.startsWith('Second opinion'));

beforeEach(() => {
  fake.cloudPrompts.length = 0;
  fake.devicePrompts.length = 0;
  fake.cloud = goodCloud;
  fake.device = goodDevice;
});

describe('an audit without the on-device model (masked cloud-only mode)', () => {
  it('labels every row, reviews every finding, and sends nothing raw', async () => {
    const s = await audit(cafe, { device: false });
    expect(s.stage).toBe('done');
    expect(s.txns.every(t => t.category && !t.unsure)).toBe(true);
    expect(s.findings.length).toBeGreaterThanOrEqual(4);
    expect(s.findings.every(f => f.reviewStatus === 'done')).toBe(true);
    expect(fake.devicePrompts).toEqual([]); // no on-device model: nothing is ever handed to one
    const c = check(s);
    expect(c.requests).toBe(s.ledger.length);
    expect(c.found).toEqual([]);
    // Names come back only on the device.
    expect(s.findings.some(f => f.review!.maskedExplanation.includes('[BUSINESS_1]') && !f.review!.explanation.includes('[BUSINESS_1]'))).toBe(true);
  });

  it('sends one line per payee, not one per row', async () => {
    const s = await audit(cafe, { device: false });
    const sent = labelRequests(s).flatMap(l => l.text.split('\n').filter(x => /^r\d+: /.test(x)));
    const unruled = s.txns.filter(t => t.categorySource === 'cloud');
    const payees = new Set(unruled.map(t => `${t.direction}:${t.counterpartyKey || t.narration}`));
    expect(sent.length).toBe(payees.size);
    expect(sent.length).toBeLessThan(unruled.length);
  });

  it('stops asking for labels at the limit and leaves the rest for the person', async () => {
    const s = await audit(forty, { device: false, maxLabelRequests: 1 });
    expect(s.stage).toBe('done');
    expect(labelRequests(s)).toHaveLength(1);
    expect(s.unlabelled).toBe(41 - 15);
    expect(s.txns.filter(t => t.unsure)).toHaveLength(42 - 15);
    expect(check(s).found).toEqual([]);
  });

  it('reviews the most serious findings and leaves the rest for a click', async () => {
    const s = await audit(cafe, { device: false, maxReviews: 2 });
    expect(s.findings.filter(f => f.reviewStatus === 'done')).toHaveLength(2);
    expect(s.findings.filter(f => f.reviewStatus === 'skipped').length).toBe(s.findings.length - 2);
    expect(s.findings.slice(0, 2).every(f => f.reviewStatus === 'done')).toBe(true);
  });

  it('a cloud that fails does not stop the audit; it gives up asking for labels after two failures', async () => {
    fake.cloud = () => { throw new Error('[429] quota exceeded'); };
    const s = await audit(forty, { device: false });
    expect(s.stage).toBe('done');
    expect(labelRequests(s)).toHaveLength(2); // the third batch was never sent
    expect(s.unlabelled).toBe(41);
    expect(s.ledger.every(l => l.status === 'failed' && /quota is used up/.test(l.error ?? ''))).toBe(true);
    // The pattern itself comes from code, so it is still found; only its review is missing.
    expect(s.findings.map(f => [f.kind, f.reviewStatus])).toEqual([['DUPLICATE_PAYMENT', 'failed']]);
  });
});

describe('an audit with the on-device model', () => {
  it('raw rows go to the device only; the cloud sees placeholders', async () => {
    fake.device = text => (text.startsWith('You label') ? labels(text, 'OTH') : goodDevice(text));
    const s = await audit(cafe, { device: true });
    expect(s.stage).toBe('done');
    expect(fake.devicePrompts.some(p => p.includes('HARBORVIEW BAKERY SUPPLY'))).toBe(true);
    expect(fake.cloudPrompts.length).toBeGreaterThan(0);
    expect(fake.cloudPrompts.every(p => !/HARBORVIEW|REYES|TORRES|jenny/i.test(p))).toBe(true);
    expect(check(s).found).toEqual([]);
  });

  it('a broken on-device answer does not stop the audit: those payees get a blind second opinion', async () => {
    fake.device = text => (text.startsWith('You label') ? 'not json' : goodDevice(text));
    const s = await audit(cafe, { device: true });
    expect(s.stage).toBe('done');
    expect(s.deviceCalls.some(c => c.failed)).toBe(true);
    expect(s.txns.every(t => t.category && !t.unsure)).toBe(true);
    expect(s.txns.some(t => t.categorySource === 'cloud')).toBe(true);
    expect(check(s).found).toEqual([]);
  });

  it('a leak guard that cannot run is reported, and the rule masking still holds', async () => {
    fake.device = text => { if (text.startsWith('This text is about')) throw new Error('session lost'); return goodDevice(text); };
    const s = await audit(cafe, { device: true });
    expect(s.stage).toBe('done');
    expect(s.guardSkipped).toBeGreaterThan(0);
    expect(check(s).found).toEqual([]);
  });

  it('what the leak guard flags is masked before sending', async () => {
    // "june" is an everyday word (a month), so rules let it through. Here it is a child's name, and the guard says so.
    const csv = ['Date,Description,Withdrawals,Deposits',
      '10/14/2026,INSTANT PAY TO MIKE TORRES MEMO piano lessons june,180.00,',
      '10/15/2026,INSTANT PAY TO MIKE TORRES MEMO piano lessons june,180.00,'].join('\n');
    const before = await audit(csv, { device: true });
    expect(before.ledger.some(l => /june/i.test(l.text))).toBe(true);
    fake.device = text => (text.startsWith('This text is about') ? '{"leaks":["june"]}' : goodDevice(text));
    const s = await audit(csv, { device: true });
    expect(s.guardCatches.map(g => g.text)).toEqual(['june']);
    expect(s.ledger.length).toBeGreaterThan(0);
    expect(s.ledger.every(l => !/june/i.test(l.text))).toBe(true);
  });
});

describe('the last check before sending', () => {
  it('masks a number that is an invoice in one row and a card ending in another', async () => {
    const csv = ['Date,Description,Withdrawals,Deposits',
      '10/14/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 4471,1845.00,',
      '10/15/2026,ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 4471,1845.00,',
      '10/16/2026,INSTANT PAY TO MIKE TORRES MEMO card 4471 lunch,25.00,'].join('\n');
    const s = await audit(csv, { device: false });
    expect(s.stage).toBe('done');
    const dup = s.ledger.find(l => l.purpose.includes('duplicate'))!;
    expect(dup.status).toBe('sent');
    expect(dup.lastCheck).toEqual(['4471']);
    expect(dup.text).not.toMatch(/4471/);
    expect(check(s).found).toEqual([]);
  });
});
