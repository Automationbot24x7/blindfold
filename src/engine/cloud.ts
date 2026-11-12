// The blind review: only masked text ever reaches these calls. Cloud first; if the cloud is
// busy or the laptop is offline, the Firebase AI Logic SDK falls back to the on-device model
// (PREFER_IN_CLOUD) and says so, and the review is kept as an on-device draft.
import { Schema } from 'firebase/ai';
import { CATEGORIES, codesFor, label } from './categories';
import { money, type Currency } from './detectors';
import { cloudFirstModel, deviceModel } from '../lib/firebase';
import type { Finding, Review, Txn, Verdict } from './types';
import type { Vault } from './vault';

export interface OutgoingPayload {
  purpose: string;
  text: string; // exactly what is sent
}

const partiesOf = (rows: Txn[]) =>
  rows.filter(t => t.counterparty && (t.counterpartyKind === 'PERSON' || t.counterpartyKind === 'BUSINESS'))
    .map(t => ({ name: t.counterparty, kind: t.counterpartyKind as 'PERSON' | 'BUSINESS' }));

/** One masked line per row: only the fields the review needs (data minimisation). */
export function maskedLine(t: Txn, vault: Vault, currency: Currency, parties = partiesOf([t])): string {
  const who = t.counterparty ? vault.mask(t.counterparty, parties).text : '';
  const kind = t.counterpartyKind === 'NONE' ? '' : `(${t.counterpartyKind.toLowerCase()})`;
  const note = t.note ? vault.maskNote(t.note, parties).text : ''; // default-deny: only everyday purpose words survive
  return [
    t.date, t.direction === 'out' ? 'OUT' : 'IN', money(t.amount, currency), `via ${t.rail}`,
    who && `${who} ${kind}`, note && `note: "${note}"`, t.category && `head: ${label(t.category)}`,
  ].filter(Boolean).join(' ');
}

const REVIEW_INSTRUCTIONS =
  'You are a careful audit reviewer helping a small bookkeeping practice. Deterministic code found the pattern below in a ' +
  "client's bank statement. Real names and identifiers were replaced with placeholders in square brackets (a word, an underscore and a number, like PERSON_1): " +
  'keep every placeholder exactly as written and never guess who it is. Use only the facts given; do not calculate new numbers. ' +
  'Decide whether this is LIKELY_ISSUE, NEEDS_EXPLANATION or LIKELY_FINE. Then write two plain sentences, the way an experienced ' +
  'bookkeeper would say it to a client: what happened and why it matters (for example a refund to chase, a cash-reporting risk, ' +
  'a loan that needs paperwork). Avoid stiff phrases such as "a transaction occurred" or "requires proper documentation", and do not ' +
  'repeat the field names. Finally write one short, friendly question to ask the client.';

export function findingPayload(f: Finding, rows: Txn[], vault: Vault, currency: Currency, context: string): OutgoingPayload {
  const parties = partiesOf(rows);
  const facts = Object.entries(f.facts).map(([k, v]) => `${k}: ${v}`).join('; ');
  const text =
    `${REVIEW_INSTRUCTIONS}\n\nOrganisation: ${context}\nPattern found by code: ${f.kind.replace(/_/g, ' ').toLowerCase()}\nFacts computed by code: ${facts}\nRows:\n` +
    rows.map(t => `- ${maskedLine(t, vault, currency, parties)}`).join('\n');
  return { purpose: `Blind review: ${f.kind.replace(/_/g, ' ').toLowerCase()}`, text };
}

const reviewSchema = Schema.object({
  properties: {
    verdict: Schema.enumString({ enum: ['LIKELY_ISSUE', 'NEEDS_EXPLANATION', 'LIKELY_FINE'] }),
    explanation: Schema.string(),
    clientQuestion: Schema.string(),
  },
});
const reviewConstraint = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['LIKELY_ISSUE', 'NEEDS_EXPLANATION', 'LIKELY_FINE'] },
    explanation: { type: 'string' },
    clientQuestion: { type: 'string' },
  },
  required: ['verdict', 'explanation', 'clientQuestion'],
};

export interface CloudFirstResult {
  text: string;
  source: 'in_cloud' | 'on_device';
  fallbackReason?: string; // why the device answered instead of the cloud
  ms: number;
}

/**
 * Cloud first (PREFER_IN_CLOUD: the SDK itself falls back to the device on network errors such
 * as being offline or a busy model), plus a deadline: if the cloud has not answered in time,
 * the same masked text goes to the on-device model and the answer is labelled as a device draft.
 */
export async function cloudFirst(
  inCloud: Parameters<typeof cloudFirstModel>[0], constraint: object, text: string, deadlineMs = 25_000,
): Promise<CloudFirstResult> {
  const t0 = performance.now();
  const model = cloudFirstModel(inCloud, { responseConstraint: constraint });
  try {
    const res = await model.generateContent(text, { timeout: deadlineMs });
    const src = res.response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud';
    return { text: res.response.text(), source: src, fallbackReason: src === 'on_device' ? 'cloud unreachable' : undefined, ms: performance.now() - t0 };
  } catch (e) {
    const slow = (e as Error).name === 'AbortError' || /timeout/i.test((e as Error).message);
    if (!slow) throw e;
    const res = await deviceModel({ responseConstraint: constraint }).generateContent(text);
    return { text: res.response.text(), source: 'on_device', fallbackReason: `cloud took over ${Math.round(deadlineMs / 1000)} s`, ms: performance.now() - t0 };
  }
}

export async function reviewFinding(payload: OutgoingPayload, cloudModelName: string, vault: Vault): Promise<Review> {
  const r = await cloudFirst(
    { model: cloudModelName, generationConfig: { responseMimeType: 'application/json', responseSchema: reviewSchema, temperature: 0.2 } },
    reviewConstraint,
    payload.text, // exactly the text shown in the privacy receipt
  );
  const j = JSON.parse(r.text) as { verdict: Verdict; explanation: string; clientQuestion: string };
  return {
    verdict: j.verdict,
    maskedExplanation: j.explanation,
    maskedClientQuestion: j.clientQuestion,
    explanation: vault.restore(j.explanation),
    clientQuestion: vault.restore(j.clientQuestion),
    source: r.source,
    model: r.source === 'on_device' ? `on-device model (${r.fallbackReason})` : cloudModelName,
    ms: r.ms,
  };
}

/** Second opinion on rows the device was unsure about: built first (masked), sent later. */
export function secondOpinionPayload(rows: Txn[], vault: Vault, currency: Currency, context: string): OutgoingPayload {
  const parties = partiesOf(rows);
  const all = [...new Set(rows.flatMap(r => codesFor(r.direction)))].filter(c => c !== 'UNS');
  const legend = CATEGORIES.filter(c => all.includes(c.code)).map(c => `${c.code} = ${c.label}: ${c.hint}`).join('\n');
  const text =
    `Label each bank-statement line for the books. Organisation: ${context}\nCodes:\n${legend}\n\n` +
    'Pick one code per line. Names are placeholders; judge from the rest of the line.\n' +
    rows.map((t, k) => `r${k + 1}: ${maskedLine({ ...t, category: undefined }, vault, currency, parties)}`).join('\n');
  return { purpose: `Second opinion on ${rows.length} unsure row${rows.length === 1 ? '' : 's'}`, text };
}

export async function runSecondOpinion(
  payload: OutgoingPayload, rows: Txn[], cloudModelName: string,
): Promise<{ codes: string[]; source: 'in_cloud' | 'on_device'; ms: number }> {
  const all = [...new Set(rows.flatMap(r => codesFor(r.direction)))].filter(c => c !== 'UNS');
  const props = Object.fromEntries(rows.map((_, k) => [`r${k + 1}`, Schema.enumString({ enum: all })]));
  const jsonProps = Object.fromEntries(rows.map((_, k) => [`r${k + 1}`, { type: 'string', enum: all }]));
  const r = await cloudFirst(
    { model: cloudModelName, generationConfig: { responseMimeType: 'application/json', responseSchema: Schema.object({ properties: props }), temperature: 0 } },
    { type: 'object', properties: jsonProps, required: Object.keys(jsonProps) },
    payload.text,
  );
  const parsed = JSON.parse(r.text) as Record<string, string>;
  return {
    codes: rows.map((row, k) => (codesFor(row.direction).includes(parsed[`r${k + 1}`]) ? parsed[`r${k + 1}`] : 'UNS')),
    source: r.source,
    ms: r.ms,
  };
}
