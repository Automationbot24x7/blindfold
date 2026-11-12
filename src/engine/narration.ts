// Deterministic narration parser: rail, counterparty, UPI ID and free-text note.
// Bank narrations are semi-structured, so code handles the structure and the on-device
// model only has to deal with the language.
import type { CounterpartyKind, Rail } from './types';

export interface ParsedNarration {
  rail: Rail;
  counterparty: string;
  vpa?: string;
  ref?: string;
  note: string;
}

const VPA = /\b[a-z0-9._-]{2,}@[a-z][a-z0-9.]{1,}\b/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_CODE = /^[A-Z]{4}$/;
const DIGITS = /^[0-9Xx*]{6,}$/;
const REFLIKE = /^[A-Z]?[0-9]{8,}$/;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** US/UK style "PAYEE NAME MEMO text" or "PAYEE NAME INV 4471": split the payee from the memo. */
function splitMemo(body: string): { name: string; note: string } {
  const m = body.split(/\s+MEMO:?\s+/i);
  if (m.length > 1) return { name: clean(m[0]), note: clean(m.slice(1).join(' ')) };
  const idx = body.search(/\s(?:INV|INVOICE|BILL|PMT|PAYMENT|PREMIUM|REF|PPD ID|WEB ID|ACCT|AUTOPAY|UTIL|ID)\b/i);
  if (idx > 0) return { name: clean(body.slice(0, idx)), note: clean(body.slice(idx)) };
  return { name: clean(body), note: '' };
}

function pickName(parts: string[]): { name: string; rest: string[] } {
  // First segment that looks like a name: has letters, is not a code, IFSC, ref or UPI ID.
  const idx = parts.findIndex(
    p => /[A-Za-z]{2,}/.test(p) && !IFSC.test(p) && !BANK_CODE.test(p) && !VPA.test(p) && !REFLIKE.test(p) &&
      !/^(DR|CR|P2A|P2M|P2P|UPI|NEFT|IMPS|RTGS|CLG|BPAY|BIL|TPT)$/i.test(p),
  );
  if (idx < 0) return { name: '', rest: parts };
  return { name: clean(parts[idx]), rest: parts.slice(idx + 1) };
}

function noteFrom(rest: string[]): string {
  return clean(
    rest.filter(p => !IFSC.test(p) && !BANK_CODE.test(p) && !VPA.test(p) && !DIGITS.test(p) && !REFLIKE.test(p)).join(' '),
  );
}

export function parseNarration(raw: string): ParsedNarration {
  const n = clean(raw);
  const up = n.toUpperCase();
  const vpa = n.match(VPA)?.[0];
  // Banks use one separator style per statement: "UPI/DR/..." or "UPI-NAME-...".
  const sep = /[/|]/.test(n) ? /[/|]/ : /-/;
  const parts = n.split(sep).map(clean).filter(Boolean);

  if (/^REV\b|REVERSAL|REFUND/.test(up)) {
    const { name, rest } = pickName(parts.slice(1).filter(p => !/^UPI$/i.test(p)));
    return { rail: 'TRANSFER', counterparty: name, vpa, note: noteFrom(rest) || 'Refund' };
  }
  if (/^(UPI)\b/.test(up)) {
    const ref = parts.find(p => /^[0-9]{10,}$/.test(p));
    const { name, rest } = pickName(parts.slice(1));
    return { rail: 'UPI', counterparty: name, vpa, ref, note: noteFrom(rest) };
  }
  for (const rail of ['NEFT', 'IMPS', 'RTGS'] as const) {
    if (up.startsWith(rail)) {
      const ref = parts.find(p => REFLIKE.test(p));
      const { name, rest } = pickName(parts.slice(1));
      return { rail, counterparty: name, vpa, ref, note: noteFrom(rest) };
    }
  }
  if (/^(ATM|ATW|NWD)\b|ATM WITHDRAWAL|CASH WITHDRAWAL/.test(up)) return { rail: 'ATM', counterparty: '', note: noteFrom(parts.slice(1)) };
  if (/^(CASH DEP|BY CASH|CASH DEPOSIT)/.test(up)) return { rail: 'CASH', counterparty: '', note: noteFrom(parts.slice(1)) };
  if (/^POS\b|^CARD PURCHASE|^DEBIT CARD/.test(up)) {
    const name = clean(n.replace(/^(POS|CARD PURCHASE|DEBIT CARD)\s*/i, '').replace(/^[0-9X*]{6,}\s*/, '').replace(/^\d{2}\/\d{2}\s*/, '').replace(/#\d+.*$/, ''));
    return { rail: up.startsWith('POS') ? 'POS' : 'CARD', counterparty: name, note: '' };
  }
  if (/^(NACH|ACH)\b/.test(up)) {
    const body = n.replace(/^(NACH|ACH)\s*(D-|C-|DEBIT|CREDIT|DEPOSIT)?\s*(TP ACH)?\s*/i, '');
    const rail = up.startsWith('NACH') ? 'NACH' : 'ACH';
    if (/[/]|\S-\S/.test(body)) {
      const { name, rest } = pickName(body.split(/[/-]/).map(clean).filter(Boolean));
      return { rail, counterparty: name, note: noteFrom(rest) };
    }
    const { name, note } = splitMemo(body);
    return { rail, counterparty: name, note };
  }
  if (/^(CHQ|CHEQUE|CHECK)\b/.test(up)) {
    const rail = up.startsWith('CHECK') ? 'CHECK' : 'CHEQUE';
    if (parts.length > 1) {
      const { name, rest } = pickName(parts.slice(1));
      return { rail, counterparty: name, note: noteFrom(rest) };
    }
    // "CHECK 1043 OAKWOOD VETERINARY CLINIC"
    const name = clean(n.replace(/^(CHQ|CHEQUE|CHECK)\s*(DEP(OSIT)?|PAID|NO\.?)?\s*#?\d*\s*/i, ''));
    return { rail, counterparty: name, ref: n.match(/\d{3,}/)?.[0], note: '' };
  }
  if (/^(INT\.?PD|CREDIT INTEREST|INTEREST)/.test(up)) return { rail: 'INTEREST', counterparty: '', note: 'Interest' };
  if (/CHARGES|CHG\b|ANNUAL FEE|SERVICE FEE|MONTHLY FEE/.test(up) && !/UPI|NEFT|IMPS/.test(up)) return { rail: 'CHARGES', counterparty: '', note: noteFrom(parts) };
  if (/^(GST|TDS|INCOME TAX|CBDT|IRS|TAX PAYMENT)/.test(up)) return { rail: 'TAX', counterparty: '', note: noteFrom(parts) };
  if (/^BIL\b/.test(up)) {
    const { name, rest } = pickName(parts.slice(1));
    return { rail: 'OTHER', counterparty: name, note: noteFrom(rest) };
  }
  if (/^(WIRE|INSTANT PAY|ONLINE TRANSFER|TRANSFER|TO TRANSFER|BY TRANSFER)/.test(up)) {
    const body = n.replace(/^(WIRE (IN|OUT)?|INSTANT PAY|ONLINE TRANSFER|TO TRANSFER|BY TRANSFER|TRANSFER)\s*(TO|FROM)?\s*/i, '');
    const rail = up.startsWith('WIRE') ? 'WIRE' : 'TRANSFER';
    if (body.includes('/')) {
      const { name, rest } = pickName(body.split('/').map(clean).filter(Boolean));
      return { rail, counterparty: name, note: noteFrom(rest) };
    }
    const { name, note } = splitMemo(body);
    return { rail, counterparty: name, note };
  }
  if (/^MOBILE (CHECK )?DEPOSIT|^REMOTE DEPOSIT/.test(up)) return { rail: 'CHECK', counterparty: '', note: 'Mobile check deposit' };
  if (/^DEPOSIT\b/.test(up)) {
    const { name, note } = splitMemo(n.replace(/^DEPOSIT\s*/i, ''));
    return { rail: 'OTHER', counterparty: name, note };
  }
  const { name, rest } = pickName(parts);
  return { rail: 'OTHER', counterparty: name, vpa, note: noteFrom(rest) };
}

const BUSINESS = /\b(PVT|LTD|LLP|LIMITED|INC|LLC|CORP|CO\b|COMPANY|TRADERS|TRADING|ENTERPRISES?|STORES?|MART|SUPERMARKET|AGENCY|AGENCIES|SERVICES|INDUSTRIES|SOLUTIONS|SYSTEMS|TECHNOLOGIES|SOFTWARE|FOODS|ELECTRICALS|HARDWARE|MEDICAL|PHARMA|MOTORS|BROADBAND|TELECOM|INSURANCE|FINANCE|LOANS|CAPITAL|BANK|HOTEL|RESTAURANT|CAFE|CABS|FUEL|STATION|DEPOT|SUPPLY|SUPPLIES|WHOLESALE|DISTRIBUTORS|SPACES|CONSULTING|ASSOCIATES|FOUNDATION|TRUST|SOCIETY|ASSOCIATION|BOARD|SECURITY|MAINTENANCE|LIFTS?|ELEVATORS?|GARDEN|PEST|PLUMBING|PRINTERS?|STATIONERY|WORLD|MARKETPLACE|SETTLEMENT|SUBSCRIPTION|POWER|WATER|GAS|UTILITY|UTILITIES|CLINIC|HOSPITAL|SCHOOL|ACADEMY|COLLEGE|UNIVERSITY|CINEMA|CINEMAS|PETSUPPLY|VET|VETERINARY|RESCUE)\b/;
const GOVT = /\b(GST|TDS|CBDT|INCOME TAX|MUNICIPAL|GOVT|GOVERNMENT|IRS|TREASURY|DEPT OF|DEPARTMENT OF|REVENUE|HMRC|FRANCHISE TAX)\b/;

export function counterpartyKind(name: string, rail: Rail, note = ''): CounterpartyKind {
  const up = `${name} ${note}`.toUpperCase();
  if (!name) return rail === 'TAX' ? 'GOVERNMENT' : rail === 'CHARGES' || rail === 'INTEREST' ? 'BANK' : 'NONE';
  if (/^SELF\b|OWN ACCOUNT|TO SAV|TO SAVINGS|^(SAV|SAVINGS|CHECKING|CHK)\b/.test(up)) return 'SELF';
  if (GOVT.test(name.toUpperCase())) return 'GOVERNMENT';
  if (/\bBANK\b/.test(name.toUpperCase())) return 'BANK';
  if (BUSINESS.test(name.toUpperCase())) return 'BUSINESS';
  // Two or three alphabetic words with no business marker: most likely a person.
  if (/^[A-Za-z]+(\s[A-Za-z.]+){1,3}$/.test(name.trim())) return 'PERSON';
  return 'BUSINESS';
}

export function counterpartyKey(name: string, vpa?: string): string {
  const k = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(PVT|LTD|LLP|LIMITED|INC|LLC|THE|M S|MS)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return k || (vpa ? vpa.toLowerCase().split('@')[0] : '');
}
