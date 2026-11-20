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
      !/^(DR|CR|P2A|P2M|P2P|UPI|NEFT|IMPS|RTGS|CLG|BPAY|BIL|TPT|ONL|INF|MMT|MOB|NFS|ECS|NET|INB|TRF|TFR)$/i.test(p),
  );
  if (idx < 0) return { name: '', rest: parts };
  return { name: clean(parts[idx]), rest: parts.slice(idx + 1) };
}

function noteFrom(rest: string[]): string {
  return clean(
    rest.filter(p => !IFSC.test(p) && !BANK_CODE.test(p) && !VPA.test(p) && !DIGITS.test(p) && !REFLIKE.test(p)).join(' '),
  );
}

const STOP = /^(ON|REF|CONF|CONFIRMATION|MEMO|FOR|ID|TRN|TRACE|TRANSACTION|INV|INVOICE)$/i;

/**
 * The leading words of a line that read like a name: everything up to the first reference
 * number, date or (optionally) keyword. "TOM BECKET JPM99A1B2C3D" -> "TOM BECKET".
 */
function leadingName(s: string, keywords = true, max = 6): { name: string; rest: string } {
  const words = s.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && i < max) {
    const w = words[i];
    if (/\d/.test(w) || /^[#*]+$/.test(w) || (keywords && i > 0 && STOP.test(w.replace(/[^A-Za-z]/g, '')))) break;
    i++;
  }
  return { name: clean(words.slice(0, i).join(' ').replace(/[*#]+/g, ' ').replace(/[;,:]+$/, '')), rest: words.slice(i).join(' ') };
}

/** What is left of a line once reference numbers, confirmation codes and dates are taken out. */
function tidyNote(s: string): string {
  return clean(
    s.replace(/^\s*MEMO:?\s*/i, ' ')
      .replace(/\bON \d{1,2}\/\d{1,2}(\/\d{2,4})?(?!\d)/gi, ' ')
      .replace(/\b(?:REF|CONF|CONFIRMATION|ID|TRN|TRACE|TRANSACTION|SEQ)\s*(?:NO\.?|NUMBER)?\s*#?:?\s*[A-Z0-9-]*\d[A-Z0-9-]*/gi, ' ')
      .replace(/\b[A-Z0-9]*\d[A-Z0-9]{5,}\b/gi, ' ')
      .replace(/(^|\s)[#*]+(?=\s|$)/g, ' '),
  );
}

export function parseNarration(raw: string): ParsedNarration {
  const n = clean(raw);
  const up = n.toUpperCase();
  const vpa = n.match(VPA)?.[0];
  // Banks use one separator style per statement: "UPI/DR/..." or "UPI-NAME-...".
  const sep = /[/|]/.test(n) ? /[/|]/ : /-/;
  const parts = n.split(sep).map(clean).filter(Boolean);

  // --- Wording used by the large US banks -------------------------------------------------
  // "Zelle payment from MARIA GONZALEZ 12345678901", "Zelle Transfer Conf# abc123; SAVANNAH JONES",
  // "ZELLE FROM PRIYA NAIR ON 11/02 REF # WFCT0ABC1234 RENT NOV"
  if (/^ZELLE\b/.test(up)) {
    const afterSemi = n.match(/;\s*(.+)$/)?.[1];
    const body = afterSemi ?? n.replace(/^ZELLE\s+(?:(?:INSTANT\s+)?(?:PAYMENT|PMT|TRANSFER|MONEY)\s+)?(?:RECEIVED\s+|SENT\s+)?(?:TO\s+|FROM\s+)?/i, '');
    const { name, rest } = leadingName(body);
    return { rail: 'TRANSFER', counterparty: name, note: tidyNote(rest) };
  }
  // "ORIG CO NAME:GUSTO ORIG ID:9138864001 DESC DATE:261103 CO ENTRY DESCR:TAX SEC:CCD ... IND NAME:(the account holder)"
  const orig = n.match(/^ORIG CO NAME:\s*(.+?)\s+ORIG ID:/i);
  if (orig) {
    const descr = n.match(/CO ENTRY DESCR:\s*(.+?)\s*(?:SEC:|TRACE#|EED:|IND ID:|$)/i)?.[1] ?? '';
    return { rail: 'ACH', counterparty: clean(orig[1]), note: tidyNote(descr) };
  }
  // "WIRE TYPE:WIRE IN DATE: 261004 TIME:0931 ET TRN:... ORIG:REYES CONSTRUCTION LLC ID:123456789 SND BK:..."
  if (/^WIRE TYPE:/.test(up)) {
    const who = n.match(/\b(?:ORIG|BNF):\s*(.+?)\s+(?:ID:|SND BK:|BNF BK:|PMT DET:|$)/i)?.[1] ?? '';
    const det = n.match(/PMT DET:\s*(.+)$/i)?.[1] ?? '';
    return { rail: 'WIRE', counterparty: clean(who), note: tidyNote(det) };
  }
  // "Online Transfer to SAV ...4410 transaction#: 12345678901", "Online Banking transfer to CHK 8812 Confirmation# ..."
  const own = n.match(/^(?:ONLINE\s+)?(?:BANKING\s+)?(?:TRANSFER|XFER)\s+(?:TO|FROM)\s+((?:SAV|SAVINGS|CHK|CHECKING|MMA|MONEY MARKET)\b\s*[.xX*]*\s*\d{0,6})/i);
  if (own) return { rail: 'TRANSFER', counterparty: clean(own[1]), note: '' };

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
  if (/^ATM (CASH )?DEPOSIT|^(CASH DEP|BY CASH|CASH DEPOSIT)/.test(up)) return { rail: 'CASH', counterparty: '', note: noteFrom(parts.slice(1)) };
  if (/^ATM CHECK DEPOSIT/.test(up)) return { rail: 'CHECK', counterparty: '', note: 'Check deposit' };
  // The digits after an ATM withdrawal are the machine or the card: nothing a ledger needs.
  if (/^(ATM|ATW|NWD)\b|ATM WITHDRAWAL|CASH WITHDRAWAL|\bATM\b.*\b(WITHDRWL|WITHDRAWAL|W\/D)\b/.test(up)) return { rail: 'ATM', counterparty: '', note: '' };
  // "CARD PURCHASE 08/19 PETSUPPLY DEPOT #221", "CHECKCARD 1002 SHELL OIL 57444 HOUSTON TX 2469...",
  // "PURCHASE AUTHORIZED ON 11/01 AMZN Mktp US*AB1CD2EF3 Amzn.com/bill WA S30... CARD 4471"
  if (/^(POS|CARD PURCHASE|DEBIT CARD|CHECK ?CARD|PURCHASE AUTHORIZED ON|RECURRING PAYMENT AUTHORIZED ON)\b/.test(up)) {
    const body = n.replace(/^(POS(?: DEBIT| PURCHASE)?|CARD PURCHASE|DEBIT CARD(?: PURCHASE)?|CHECK ?CARD|PURCHASE AUTHORIZED ON|RECURRING PAYMENT AUTHORIZED ON)\s*/i, '')
      .replace(/^[0-9X*]{6,}\s*/, '').replace(/^\d{2}\/\d{2}\s*/, '').replace(/^CHECK ?CARD\s*/i, '');
    const merchant = /^CHECK ?CARD\b/.test(up) ? body.replace(/^\d{4}\s+/, '') : body;
    const { name } = leadingName(merchant, false);
    return { rail: up.startsWith('POS') ? 'POS' : 'CARD', counterparty: name || clean(merchant.replace(/#\d+.*$/, '')), note: '' };
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
    // "CHECK 1043 OAKWOOD VETERINARY CLINIC", "CHECK # 1043"
    const name = clean(n.replace(/^(CHQ|CHEQUE|CHECK)\s*(DEP(OSIT)?|PAID|NO\.?)?\s*#?\s*\d*\s*/i, ''));
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
  if (/^(MOBILE|REMOTE)( ONLINE| CHECK)? DEPOSIT/.test(up)) return { rail: 'CHECK', counterparty: '', note: 'Mobile check deposit' };
  if (/^DEPOSIT\b/.test(up)) {
    const body = n.replace(/^DEPOSIT\s*/i, '');
    // "DEPOSIT ID NUMBER 123456": a counter deposit, with nobody named.
    if (!body || /^(?:(?:ID|REF|NUMBER|NO)\b|#|\d)/i.test(body)) return { rail: 'OTHER', counterparty: '', note: 'Deposit' };
    const { name, note } = splitMemo(body);
    return { rail: 'OTHER', counterparty: name, note };
  }
  // No recognised wording. Structured text (A/B/C or A-B-C) is split on its separator; a plain
  // line gives its leading words as the payee, up to the first reference number, date or keyword.
  const flat = n.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?(?!\d)/g, ' ');
  const fields = flat.split(/[/|]/.test(flat) ? /[/|]/ : /-/).map(clean).filter(Boolean);
  if (fields.length >= 3) {
    const { name, rest } = pickName(fields);
    return { rail: 'OTHER', counterparty: name, vpa, note: noteFrom(rest) };
  }
  const { name, rest } = leadingName(clean(flat));
  return { rail: 'OTHER', counterparty: name || clean(n), vpa, note: tidyNote(rest) };
}

// Words that only an organisation carries in its name.
const BUSINESS = /\b(PVT|LTD|LLP|LIMITED|INC|LLC|CORP|CO\b|COMPANY|TRADERS|TRADING|ENTERPRISES?|STORES?|MART|SUPERMARKET|AGENCY|AGENCIES|SERVICES|INDUSTRIES|SOLUTIONS|SYSTEMS|TECHNOLOGIES|SOFTWARE|FOODS|ELECTRICALS|HARDWARE|MEDICAL|PHARMA|MOTORS|BROADBAND|TELECOM|INSURANCE|FINANCE|LOANS|CAPITAL|BANK|HOTEL|RESTAURANT|CAFE|CABS|FUEL|STATION|DEPOT|SUPPLY|SUPPLIES|WHOLESALE|DISTRIBUTORS|SPACES|CONSULTING|ASSOCIATES|FOUNDATION|TRUST|SOCIETY|ASSOCIATION|BOARD|SECURITY|MAINTENANCE|LIFTS?|ELEVATORS?|GARDEN|PEST|PLUMBING|PRINTERS?|STATIONERY|WORLD|MARKETPLACE|SETTLEMENT|SUBSCRIPTION|POWER|WATER|GAS|UTILITY|UTILITIES|CLINIC|HOSPITAL|SCHOOL|ACADEMY|COLLEGE|UNIVERSITY|CINEMA|CINEMAS|PETSUPPLY|VET|VETERINARY|RESCUE|SPA|SALON|JEWELERS|JEWELLERS|JEWELRY|JEWELLERY|BOUTIQUE|COFFEE|ROASTERS|BAKERY|DAIRY|PROPERTIES|REALTY|LANDSCAPING|ROOFING|PAVING|CONSTRUCTION|CPA|GROUP|PARTNERS|HOLDINGS|PAYROLL|SVC|LINEN|CORNER|CAB|DEPOT|WAREHOUSE|OUTLET|PHARMACY|DENTAL|MOTEL|INN|GRILL|KITCHEN|DINER|PIZZA|BAR|PUB|STUDIO|GALLERY|MEDIA|THEATER|THEATRE|CHURCH|TEMPLE|CLUB|ACADEMY|BOOKKEEPING|INTERNET|PROCESSING|PAYMENTS?|CARRY|ASSOCIATION|HOA|MONTHLY|WEEKLY|ANNUAL|WEB|ONLINE|SUITE|APPS?|HOSTING|CLOUD|DIGITAL|EXPRESS|GLOBAL|INTERNATIONAL|NATIONAL|MARKET|SHOP|TECH|LABS?|DESIGN|PRINTING|AUTO|TIRES?|HEALTH|FITNESS|GYM|TAXI|AIRLINES?|AIRWAYS|STORAGE|RENTALS?|LEASING|EQUIPMENT|ELECTRIC|ENERGY|MOBILE|WIRELESS|COMMUNICATIONS|CABLE|NETWORKS?|OIL|PETROLEUM|GROCERY|GROCERS?|FARMS?|FLORIST|CATERING|CLEANERS|LAUNDRY|LOGISTICS|FREIGHT|SHIPPING|COURIER|MOVERS|TOURS|MKTP)\b/;
// A bare "REVENUE" or "TREASURY" can be anybody's name; a tax office says which one it is.
const GOVT = /\b(GST|TDS|CBDT|INCOME TAX|MUNICIPAL|GOVT|GOVERNMENT|IRS|US TREASURY|TREASURY DEPT|DEPT OF|DEPARTMENT OF|REVENUE SERVICE|INLAND REVENUE|HM REVENUE|HMRC|FRANCHISE TAX|TAX BOARD|USATAXPYMT|EFTPS)\b/;

export function counterpartyKind(name: string, rail: Rail, note = ''): CounterpartyKind {
  if (!name) return rail === 'TAX' ? 'GOVERNMENT' : rail === 'CHARGES' || rail === 'INTEREST' ? 'BANK' : 'NONE';
  const up = name.toUpperCase();
  // The client's own other account: named as such ("SAV XXXX4410", "SELF"), never guessed from a memo.
  if (/^(SELF|SAV|SAVINGS|CHECKING|CHK|MMA|MONEY MARKET)\b|\bOWN ACCOUNT\b/.test(up) || /\bOWN ACCOUNT\b|\bSELF TRANSFER\b/.test(note.toUpperCase())) return 'SELF';
  if (GOVT.test(up)) return 'GOVERNMENT';
  if (/\bBANK\b/.test(up)) return 'BANK';
  if (/^(MR|MRS|MS|MISS|DR|SHRI|SMT)\.?\s+[A-Z]/.test(up) && !BUSINESS.test(up)) return 'PERSON';
  if (BUSINESS.test(up)) return 'BUSINESS';
  // A word with no vowel is an abbreviation (MKTP, SVC, MGMT), which people's names are not.
  if (up.split(/\s+/).some(w => w.length >= 3 && /^[A-Z]+$/.test(w) && !/[AEIOUY]/.test(w))) return 'BUSINESS';
  // Two to four alphabetic words with no business marker: most likely a person.
  if (/^[A-Za-z]+(\s[A-Za-z.]+){1,3}$/.test(name.trim())) return 'PERSON';
  return 'BUSINESS';
}

export function counterpartyKey(name: string, vpa?: string): string {
  const k = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(PVT|LTD|LLP|LIMITED|INC|LLC|THE|M S|MS)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return k || (vpa ? vpa.toLowerCase().split('@')[0] : '');
}
