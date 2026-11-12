// On-device language work (Firebase AI Logic, ONLY_ON_DEVICE). Raw statement text is only
// ever given to these functions. If the device has no model, the SDK throws instead of
// sending anything to the cloud.
import { CATEGORIES, codesFor } from './categories';
import { money, type Currency } from './detectors';
import { deviceModel } from '../lib/firebase';
import { expandHits, usefulHits } from './guard';
import type { Direction, Txn } from './types';

export interface PayeeGroup {
  key: string;
  direction: Direction;
  txns: Txn[];
}

export interface DeviceCall {
  purpose: string;
  rows: number;
  ms: number;
  source: string; // as reported by the SDK
}

const examples: Record<Direction, string> = {
  // Made-up examples that appear in none of the sample statements (so accuracy is not inflated).
  out: [
    'Example: OUT $3,120.00 | NORTHSTAR WHOLESALE FOODS (business) | note: INV 5521 => PUR',
    'Example: OUT $118.00 | CITYNET WIRELESS (business) | note: monthly plan => UTL',
    'Example: OUT $1,500.00 | ALAN PRICE (person) | note: studio rent => RNT',
    'Example: OUT $950.00 | LITTLE STARS ACADEMY (business) | note: none => DRW',
    'Example: OUT $300.00 | KESSLER TAX ADVISORS (business) | note: return filing => FEE',
    'Example: OUT $640.00 | EVERGLADE LAWN CARE (business) | note: monthly service => SUP',
    'Example: OUT $36.50 | CITYLINE TAXI (business) | note: none => TRV',
    'Example: OUT $180.00 | SERENITY NAIL SPA (business) | note: none => DRW',
  ].join('\n'),
  in: [
    'Example: IN $1,164.20 | SWIFTPAY SETTLEMENT (business) | note: none => SAL',
    'Example: IN $2,000.00 | OLIVIA GRANT (person) | note: loan repaid => ADV',
    'Example: IN $175.00 | NINA SHAW (person) | note: invoice 31 balance => SAL',
    'Example: IN $600.00 | RITA SAXENA (person) | note: unit 12 dues => DUE',
  ].join('\n'),
};

function lineFor(g: PayeeGroup, currency: Currency): string {
  const t = g.txns[0];
  const amounts = g.txns.map(x => x.amount);
  const amt = amounts.length > 1 ? `${money(Math.min(...amounts), currency)}–${money(Math.max(...amounts), currency)} ×${amounts.length}` : money(t.amount, currency);
  const kind = t.counterpartyKind === 'PERSON' ? 'person' : t.counterpartyKind === 'BUSINESS' ? 'business' : t.counterpartyKind.toLowerCase();
  // Reference and ID numbers carry no meaning for a ledger head (and "REF" reads like "refund").
  const tidy = (s: string) => s.replace(/\b(?:REF|ID|TRACE|CONF|NO)\b\.?\s*#?\s*[A-Z0-9-]*\d[A-Z0-9-]*/gi, '').replace(/\b\d{6,}\b/g, '').replace(/\s+/g, ' ').trim();
  const notes = [...new Set(g.txns.map(x => tidy(x.note)).filter(Boolean))].slice(0, 2).join('; ');
  const who = t.counterparty || t.narration;
  return `${g.direction.toUpperCase()} ${amt} | ${who} (${kind}) | note: ${notes || 'none'}`;
}

/** Categorise payee groups on device, one direction per prompt, answers anchored by key. */
export async function categoriseOnDevice(
  groups: PayeeGroup[],
  currency: Currency,
  context: string,
  onBatch: (done: PayeeGroup[], codes: string[], call: DeviceCall) => void,
  batchSize = 12,
): Promise<void> {
  for (const dir of ['out', 'in'] as const) {
    const list = groups.filter(g => g.direction === dir);
    const codes = codesFor(dir);
    const legend = CATEGORIES.filter(c => codes.includes(c.code)).map(c => `${c.code} = ${c.hint}`).join('\n');
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      const props = Object.fromEntries(batch.map((_, k) => [`r${k + 1}`, { type: 'string', enum: codes }]));
      const model = deviceModel({
        responseConstraint: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false },
      });
      const prompt =
        `You label bank-statement lines for the books of ${context}. ` +
        `Each line is money ${dir === 'out' ? 'paid OUT of' : 'received INTO'} the account. ` +
        'Pick the single best code for each line. Use UNS only when the line gives no clue.\n\n' +
        `Codes:\n${legend}\n\n${examples[dir]}\n\nLines:\n` +
        batch.map((g, k) => `r${k + 1}: ${lineFor(g, currency)}`).join('\n');
      const t0 = performance.now();
      const res = await model.generateContent(prompt);
      const ms = performance.now() - t0;
      const parsed = JSON.parse(res.response.text()) as Record<string, string>;
      const answer = batch.map((_, k) => (codes.includes(parsed[`r${k + 1}`]) ? parsed[`r${k + 1}`] : 'UNS'));
      onBatch(batch, answer, { purpose: `Label ${batch.length} payees (${dir === 'out' ? 'money out' : 'money in'})`, rows: batch.reduce((s, g) => s + g.txns.length, 0), ms, source: res.response.inferenceSource ?? 'unknown' });
    }
  }
}

/**
 * On-device leak guard: reads text that is about to leave the device and lists anything that
 * still looks like a personal name or identifier. Returns exact substrings to mask.
 */
export async function leakGuard(maskedText: string): Promise<{ hits: string[]; call: DeviceCall }> {
  const model = deviceModel({
    responseConstraint: {
      type: 'object',
      properties: { leaks: { type: 'array', items: { type: 'string' }, maxItems: 12 } },
      required: ['leaks'],
    },
  });
  const prompt =
    'This text is about to be sent to a cloud service. Placeholders in square brackets like [PERSON_2] are already safe. ' +
    "List every remaining word or phrase that could identify a real person: first names, surnames, nicknames, phone numbers, " +
    'ID numbers, account numbers, email or street addresses. Do not list placeholders, ledger words, amounts, dates or business words ' +
    '(like rent, invoice, salary, fees, stock). Copy each item exactly as it appears. Return an empty list if nothing remains.\n\nText:\n' +
    maskedText;
  const t0 = performance.now();
  const res = await model.generateContent(prompt);
  const ms = performance.now() - t0;
  const leaks = (JSON.parse(res.response.text()) as { leaks: string[] }).leaks ?? [];
  return { hits: usefulHits(expandHits(leaks, maskedText)), call: { purpose: 'Leak guard: re-read outgoing text', rows: 0, ms, source: res.response.inferenceSource ?? 'unknown' } };
}

