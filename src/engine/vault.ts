// The placeholder vault. Real identifiers are swapped for consistent placeholders
// ([PERSON_3], [UPI_2] ...) before anything can leave the device, and swapped back
// locally when an answer returns. The vault itself never leaves the browser.
import { isSafeToken } from './safewords';

export type TokenType =
  | 'PERSON' | 'BUSINESS' | 'NAME' | 'WORD' | 'UPI' | 'EMAIL' | 'PHONE' | 'PAN' | 'AADHAAR' | 'SSN'
  | 'CARD' | 'ACCOUNT' | 'BRANCH' | 'REF';

interface Pattern { type: TokenType; re: RegExp }

// Order matters: specific shapes first, generic digit runs last.
const PATTERNS: Pattern[] = [
  { type: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}(?:\.[a-z]{2,})?\b/gi },
  { type: 'UPI', re: /\b[a-z0-9._-]{2,}@[a-z][a-z0-9]{1,}\b/gi },
  { type: 'PAN', re: /\b[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]\b/g },
  { type: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'AADHAAR', re: /\b[2-9]\d{3}\s\d{4}\s\d{4}\b/g },
  { type: 'CARD', re: /\b\d{4}[X*x]{4,8}\d{4}\b|\b(?:\d{4}[ -]){3}\d{4}\b/g },
  { type: 'BRANCH', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { type: 'PHONE', re: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{9}\b|\(\d{3}\)\s?\d{3}-\d{4}\b|\b\d{3}-\d{3}-\d{4}\b/g },
  { type: 'ACCOUNT', re: /\b[0-9Xx*]{2,}\d{4,}\b(?=.*\b(?:A\/C|ACCT|ACCOUNT)\b)|\b(?:A\/C|ACCT|ACCOUNT)\s*(?:NO\.?)?\s*[0-9Xx*]{4,18}\b/gi },
  { type: 'REF', re: /\b[A-Z]?\d{8,}\b/g },
];

export interface Masked {
  text: string;
  tokens: string[]; // placeholders used in this text
}

export class Vault {
  private valueToToken = new Map<string, string>();
  private tokenToValue = new Map<string, string>();
  private counters = new Map<TokenType, number>();
  /** Lower-cased name words known to belong to people, used to catch names in free text. */
  private nameWords = new Map<string, string>(); // word -> token of the person

  token(type: TokenType, value: string): string {
    const key = `${type}:${value.trim().toUpperCase()}`;
    let t = this.valueToToken.get(key);
    if (!t) {
      const n = (this.counters.get(type) ?? 0) + 1;
      this.counters.set(type, n);
      t = `[${type}_${n}]`;
      this.valueToToken.set(key, t);
      this.tokenToValue.set(t, value.trim());
    }
    return t;
  }

  /** Register a counterparty so every later mention is masked the same way. */
  registerParty(name: string, kind: 'PERSON' | 'BUSINESS'): string {
    const t = this.token(kind, name);
    if (kind === 'PERSON') {
      for (const w of name.split(/\s+/)) if (w.length >= 3) this.nameWords.set(w.toLowerCase(), t);
    }
    return t;
  }

  /** Mask a piece of text: known parties, known name words, then identifier patterns. */
  mask(text: string, parties: { name: string; kind: 'PERSON' | 'BUSINESS' }[] = []): Masked {
    let out = text;
    const used = new Set<string>();
    // Longest names first so "RAMESH KUMAR" wins over "RAMESH".
    for (const p of [...parties].sort((a, b) => b.name.length - a.name.length)) {
      if (!p.name) continue;
      const t = this.registerParty(p.name, p.kind);
      const re = new RegExp(escapeRe(p.name), 'gi');
      if (re.test(out)) { out = out.replace(re, t); used.add(t); }
    }
    for (const { type, re } of PATTERNS) {
      out = out.replace(re, m => {
        if (/^\[[A-Z]+_\d+\]$/.test(m)) return m;
        const t = this.token(type, m);
        used.add(t);
        return t;
      });
    }
    // Free-text mentions of known people ("lunch with ramesh") -> the same person's token.
    out = out.replace(/\b[A-Za-z]{3,}\b/g, w => {
      const t = this.nameWords.get(w.toLowerCase());
      if (t) { used.add(t); return t; }
      return w;
    });
    return { text: out, tokens: [...used] };
  }

  /**
   * Free-text notes are default-deny: after known parties and identifier patterns are masked,
   * every remaining word that is not an everyday purpose word (see safewords.ts) becomes a
   * placeholder too. A first name in a note can therefore never leave, even if every model misses it.
   */
  maskNote(text: string, parties: { name: string; kind: 'PERSON' | 'BUSINESS' }[] = []): Masked {
    const m = this.mask(text, parties);
    const used = new Set(m.tokens);
    const out = m.text.replace(/\[[A-Z]+_\d+\]|[\p{L}\p{N}][\p{L}\p{N}'’.&-]*/gu, w => {
      if (/^\[[A-Z]+_\d+\]$/.test(w)) return w;
      const core = w.replace(/[.'’&-]+$/, '');
      if (isSafeToken(core)) return w;
      const t = this.token('WORD', core);
      used.add(t);
      return t + w.slice(core.length);
    });
    return { text: out, tokens: [...used] };
  }

  /** Mask exact substrings found by the on-device leak guard. */
  maskExtra(text: string, names: string[]): Masked {
    let out = text;
    const used: string[] = [];
    for (const n of names.filter(s => s.trim().length >= 2).sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`\\b${escapeRe(n.trim())}\\b`, 'gi');
      if (!re.test(out)) continue;
      const t = this.token('NAME', n);
      for (const w of n.split(/\s+/)) if (w.length >= 3) this.nameWords.set(w.toLowerCase(), t);
      out = out.replace(re, t);
      used.push(t);
    }
    return { text: out, tokens: used };
  }

  /** Swap placeholders back to real values. Only ever runs in the browser. */
  restore(text: string): string {
    return text.replace(/\[([A-Z]+)_(\d+)\]/g, m => this.tokenToValue.get(m) ?? m);
  }

  valueOf(token: string): string | undefined {
    return this.tokenToValue.get(token);
  }

  get size(): number {
    return this.tokenToValue.size;
  }

  counts(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Cheap last-line check: does masked text still contain anything that looks like an identifier? */
export function residualIdentifiers(text: string): string[] {
  const hits: string[] = [];
  for (const { re } of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      if (!/^\[[A-Z]+_\d+\]$/.test(m[0])) hits.push(m[0]);
    }
  }
  return hits;
}
