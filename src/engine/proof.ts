// The receipt's headline ("0 raw names, IDs or account numbers sent") is measured, not asserted.
// From the raw statement we list every word and number that must stay on the device, then search
// the statement lines of every request for each of them: once just before a request is sent
// (anything found is masked on the spot, or the request is blocked) and again, from scratch,
// whenever the receipt is drawn. The check knows nothing about how masking works; it only
// compares what was read with what was sent.
import { CATEGORIES } from './categories';
import { isSafeNumber, isSafeToken, SAFE_WORDS } from './safewords';
import type { Txn } from './types';

/** Words the app itself writes into a masked line: rails, party kinds, field names, category labels. */
const OWN_WORDS = new Set([
  'upi', 'neft', 'imps', 'rtgs', 'atm', 'pos', 'nach', 'ach', 'cheque', 'cash', 'card', 'check', 'wire', 'interest',
  'charges', 'tax', 'transfer', 'other', 'in', 'out', 'via', 'note', 'category', 'person', 'business', 'bank',
  'government', 'self', 'refund', 'mobile', 'deposit', 'uncategorised',
  ...CATEGORIES.flatMap(c => c.label.toLowerCase().split(/[^a-z]+/).filter(Boolean)),
]);

const everyday = (w: string) => SAFE_WORDS.has(w) || OWN_WORDS.has(w);
const TOKEN = /[\p{L}\p{N}]+/gu;
const isDigits = (s: string) => /^\d+$/.test(s);
const isLetters = (s: string) => /^\p{L}+$/u.test(s);

/**
 * Everything in the raw statement that could identify someone: every word that is not an everyday
 * word, and every number that is not plainly a count, a year or a document number. Lower-cased.
 */
export function statementSecrets(txns: Txn[]): Set<string> {
  const secrets = new Set<string>();
  const scan = (text: string, minWord: number) => {
    let prev: string | undefined;
    for (const m of text.matchAll(TOKEN)) {
      const tok = m[0].toLowerCase();
      if (isLetters(tok)) {
        if (tok.length >= minWord && !everyday(tok)) secrets.add(tok);
      } else if (isDigits(tok)) {
        if (tok.length >= 4 && !isSafeNumber(tok, prev)) secrets.add(tok);
      } else if (!isSafeToken(tok)) {
        // letters and digits mixed (XXXX4410, JPM99A1B2C3D): the whole token and its parts
        if (tok.length >= 4) secrets.add(tok);
        for (const d of tok.match(/\d{4,}/g) ?? []) secrets.add(d);
        for (const w of tok.match(/\p{L}{3,}/gu) ?? []) if (!everyday(w)) secrets.add(w);
      }
      prev = tok;
    }
  };
  for (const t of txns) {
    scan(t.narration, 3);
    scan(t.counterparty, 2); // initials and two-letter surnames count when they are part of a name
    if (t.vpa) scan(t.vpa, 2);
    if (t.ref) scan(t.ref, 3);
  }
  return secrets;
}

/** The lines of a request that carry statement content (the standing instructions and code list do not). */
export function statementLines(text: string): string[] {
  return text.split('\n').filter(x => /^(- |r\d+: )/.test(x));
}

/** Which of the statement's secrets appear in this outgoing text? Placeholders are ignored. */
export function rawFound(text: string, secrets: Set<string>): string[] {
  const found = new Set<string>();
  const body = statementLines(text).join('\n').replace(/\[[A-Z]+_\d+\]/g, ' ');
  for (const m of body.matchAll(TOKEN)) {
    const tok = m[0].toLowerCase();
    if (secrets.has(tok)) found.add(tok);
    if (!isDigits(tok) && !isLetters(tok)) {
      for (const part of [...(tok.match(/\d{4,}/g) ?? []), ...(tok.match(/\p{L}{3,}/gu) ?? [])]) if (secrets.has(part)) found.add(part);
    }
  }
  return [...found];
}

export interface SelfCheck {
  searchedFor: number; // distinct names, words and numbers from the statement that must not leave
  requests: number; // requests that left the device and were searched
  found: { request: number; value: string }[]; // anything raw that did leave (expected: none)
}

/**
 * Re-checks, from the raw statement alone, every request that left the device. A request that
 * failed may still have reached the cloud, so those are searched as well; only requests that
 * were blocked before sending are left out.
 */
export function selfCheck(secrets: Set<string>, ledger: { id: number; status: string; text: string }[]): SelfCheck {
  const sent = ledger.filter(l => l.status !== 'blocked');
  return {
    searchedFor: secrets.size,
    requests: sent.length,
    found: sent.flatMap(l => rawFound(l.text, secrets).map(value => ({ request: l.id, value }))),
  };
}
