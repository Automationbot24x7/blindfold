// Deterministic pattern detection. Every number in a finding is computed here, by code;
// models only judge and explain what code found.
import type { Finding, Txn } from './types';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'INR';

export interface AuditConfig {
  currency: Currency;
  duplicateWindowDays: number;
  roundTripWindowDays: number;
  roundTripTolerancePct: number;
  cashThreshold: number; // reporting threshold for a single cash deposit
  structuringBandPct: number; // "just under" = within this % below the threshold
  structuringMinCount: number;
  structuringWindowDays: number;
  approvalLimit: number; // payments above this need sign-off (splitting avoids it); 0 = no approval rule
  splitWindowDays: number;
  spikeMultiple: number;
}

const WESTERN = { duplicateWindowDays: 7, roundTripWindowDays: 10, roundTripTolerancePct: 2, cashThreshold: 10000, structuringBandPct: 10, structuringMinCount: 2, structuringWindowDays: 10, approvalLimit: 2500, splitWindowDays: 7, spikeMultiple: 3 };

export const DEFAULT_CONFIG: Record<Currency, AuditConfig> = {
  EUR: { currency: 'EUR', ...WESTERN },
  GBP: { currency: 'GBP', ...WESTERN },
  INR: {
    currency: 'INR', duplicateWindowDays: 7, roundTripWindowDays: 10, roundTripTolerancePct: 2,
    cashThreshold: 50000, structuringBandPct: 10, structuringMinCount: 2, structuringWindowDays: 10,
    approvalLimit: 25000, splitWindowDays: 7, spikeMultiple: 3,
  },
  USD: {
    currency: 'USD', duplicateWindowDays: 7, roundTripWindowDays: 10, roundTripTolerancePct: 2,
    cashThreshold: 10000, structuringBandPct: 10, structuringMinCount: 2, structuringWindowDays: 10,
    approvalLimit: 2500, splitWindowDays: 7, spikeMultiple: 3,
  },
};

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round(Math.abs(Date.parse(b) - Date.parse(a)) / DAY);

export function money(n: number, currency: Currency): string {
  if (currency === 'INR') return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return sym + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const GENERIC = new Set(['TRADERS', 'ENTERPRISES', 'ENTERPRISE', 'STORE', 'STORES', 'SERVICES', 'AGENCY', 'AGENCIES', 'INDIA', 'SOLUTIONS', 'COMPANY', 'GROUP', 'FOODS', 'SUPPLY', 'SUPPLIES', 'BANK', 'CAPITAL', 'FINANCE', 'MART', 'SHOP', 'THE', 'AND', 'INDUSTRIES']);
const distinctive = (key: string) => key.split(' ').filter(w => w.length >= 4 && !GENERIC.has(w));

/**
 * Two different parties count as related when one's identity word appears in the other's name:
 * a person's surname (DANIEL REYES and REYES CONSTRUCTION LLC) or a business's brand, its first
 * distinctive word (ACME HOLDINGS and ACME TRADING). An industry word that both names happen to
 * contain (PEARLCREST DENTAL SUPPLY and BAYVIEW DENTAL BENEFITS) is not enough.
 */
function related(a: Txn, b: Txn): boolean {
  const wa = distinctive(a.counterpartyKey), wb = distinctive(b.counterpartyKey);
  const identity = (t: Txn, w: string[]) => (t.counterpartyKind === 'PERSON' ? w[w.length - 1] : w[0]);
  const ia = wa.length ? identity(a, wa) : undefined;
  const ib = wb.length ? identity(b, wb) : undefined;
  return (!!ia && wb.includes(ia)) || (!!ib && wa.includes(ib));
}

let seq = 0;
const fid = (k: string) => `${k}-${++seq}`;

export function detect(txns: Txn[], cfg: AuditConfig): Finding[] {
  seq = 0;
  const m = (n: number) => money(n, cfg.currency);
  const out = txns.filter(t => t.direction === 'out');
  const inn = txns.filter(t => t.direction === 'in');
  const findings: Finding[] = [];
  const used = new Set<string>();

  // 1. Duplicate payments: same payee, same amount, close together.
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (!a.counterpartyKey || a.counterpartyKey !== b.counterpartyKey || a.amount !== b.amount) continue;
      if (a.counterpartyKind === 'SELF') continue; // moving money to your own savings twice is not a double payment
      const gap = days(a.date, b.date);
      if (gap > cfg.duplicateWindowDays) continue;
      const invA = a.note.match(/\b(?:INV|INVOICE|BILL)\s*#?\s*(\w+)/i)?.[1];
      const invB = b.note.match(/\b(?:INV|INVOICE|BILL)\s*#?\s*(\w+)/i)?.[1];
      const sameInvoice = !!invA && invA === invB;
      // A standing payment (the same wage or delivery every week) is a routine, not a mistake:
      // three or more equal payments to one payee, this pair several days apart, no shared invoice.
      const equal = out.filter(x => x.counterpartyKey === a.counterpartyKey && x.amount === a.amount).length;
      if (equal >= 3 && gap >= 5 && !sameInvoice) continue;
      const key = `dup:${a.id}:${b.id}`;
      if (used.has(key)) continue;
      used.add(key);
      findings.push({
        id: fid('dup'), kind: 'DUPLICATE_PAYMENT', severity: sameInvoice ? 'high' : 'medium',
        title: `${m(a.amount)} paid to ${a.counterparty} twice in ${gap} day${gap === 1 ? '' : 's'}`,
        facts: { amount: m(a.amount), daysApart: gap, sameInvoiceReference: sameInvoice ? 'yes' : 'no', payments: 2 },
        txnIds: [a.id, b.id],
      });
    }
  }

  // 2. Round trips: money goes out and comes back from the same (or a related) party.
  for (const a of out) {
    if (!a.counterpartyKey || a.counterpartyKind === 'SELF') continue;
    for (const b of inn) {
      const gap = days(a.date, b.date);
      if (Date.parse(b.date) < Date.parse(a.date) || gap > cfg.roundTripWindowDays) continue;
      if (Math.abs(a.amount - b.amount) / a.amount * 100 > cfg.roundTripTolerancePct) continue;
      const same = a.counterpartyKey === b.counterpartyKey;
      const shared = !same && related(a, b);
      if (!same && !shared) continue;
      findings.push({
        id: fid('rt'), kind: 'ROUND_TRIP', severity: a.amount >= cfg.cashThreshold ? 'high' : 'medium',
        title: same
          ? `${m(a.amount)} sent to ${a.counterparty} came back ${gap} day${gap === 1 ? '' : 's'} later`
          : `${m(a.amount)} sent to ${a.counterparty} came back from ${b.counterparty} ${gap} days later`,
        facts: { amountOut: m(a.amount), amountBack: m(b.amount), daysApart: gap, whoSentItBack: same ? 'the same party' : 'a different party whose name contains the same surname or brand word' },
        txnIds: [a.id, b.id],
      });
    }
  }

  // 3. Structuring: several cash deposits just under the reporting threshold.
  const floor = cfg.cashThreshold * (1 - cfg.structuringBandPct / 100);
  const nearCash = inn.filter(t => (t.rail === 'CASH' || t.category === 'CSH') && t.amount >= floor && t.amount < cfg.cashThreshold)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < nearCash.length; i++) {
    const group = nearCash.filter(t => Date.parse(t.date) >= Date.parse(nearCash[i].date) && days(nearCash[i].date, t.date) <= cfg.structuringWindowDays);
    if (group.length >= cfg.structuringMinCount && !used.has(`str:${group[0].id}`)) {
      group.forEach(t => used.add(`str:${t.id}`));
      const total = group.reduce((s, t) => s + t.amount, 0);
      findings.push({
        id: fid('str'), kind: 'STRUCTURING', severity: 'high',
        title: `${group.length} cash deposits just under ${m(cfg.cashThreshold)} within ${days(group[0].date, group[group.length - 1].date)} days`,
        facts: { deposits: group.length, threshold: m(cfg.cashThreshold), largest: m(Math.max(...group.map(t => t.amount))), total: m(total), spanDays: days(group[0].date, group[group.length - 1].date) },
        txnIds: group.map(t => t.id),
      });
    }
  }

  // 4. Split payments: several payments to one payee, each under the approval limit, together above it.
  const byPayee = new Map<string, Txn[]>();
  for (const t of out) if (t.counterpartyKey && t.counterpartyKind !== 'SELF') byPayee.set(t.counterpartyKey, [...(byPayee.get(t.counterpartyKey) ?? []), t]);
  const inDuplicate = new Set(findings.filter(f => f.kind === 'DUPLICATE_PAYMENT').flatMap(f => f.txnIds));
  for (const list of cfg.approvalLimit > 0 ? byPayee.values() : []) {
    const under = list.filter(t => !inDuplicate.has(t.id) && t.amount < cfg.approvalLimit && t.amount >= cfg.approvalLimit * 0.6).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < under.length; i++) {
      const group = under.filter(t => Date.parse(t.date) >= Date.parse(under[i].date) && days(under[i].date, t.date) <= cfg.splitWindowDays);
      const total = group.reduce((s, t) => s + t.amount, 0);
      if (group.length >= 2 && total >= cfg.approvalLimit && !used.has(`split:${group[0].id}`)) {
        group.forEach(t => used.add(`split:${t.id}`));
        findings.push({
          id: fid('split'), kind: 'SPLIT_PAYMENT', severity: total >= cfg.approvalLimit * 2 ? 'high' : 'medium',
          title: `${group.length} payments to ${group[0].counterparty}, each under the ${m(cfg.approvalLimit)} approval limit`,
          facts: { payments: group.length, approvalLimit: m(cfg.approvalLimit), total: m(total), spanDays: days(group[0].date, group[group.length - 1].date) },
          txnIds: group.map(t => t.id),
        });
      }
    }
  }

  // 5. Personal spending through the business account.
  const personal = out.filter(t => t.category === 'DRW');
  if (personal.length) {
    const total = personal.reduce((s, t) => s + t.amount, 0);
    findings.push({
      id: fid('pers'), kind: 'PERSONAL_SPEND', severity: personal.length >= 3 ? 'medium' : 'low',
      title: `${personal.length} payment${personal.length === 1 ? ' looks' : 's look'} personal, not business (${m(total)})`,
      facts: { payments: personal.length, total: m(total) },
      txnIds: personal.map(t => t.id),
    });
  }

  // 6. Amount spikes against the payee's own history.
  for (const list of byPayee.values()) {
    if (list.length < 3) continue;
    for (const t of list) {
      const others = list.filter(o => o !== t).map(o => o.amount).sort((a, b) => a - b);
      const median = others[Math.floor(others.length / 2)];
      if (median > 0 && t.amount >= median * cfg.spikeMultiple) {
        findings.push({
          id: fid('spike'), kind: 'AMOUNT_SPIKE', severity: 'medium',
          title: `${m(t.amount)} to ${t.counterparty} is ${(t.amount / median).toFixed(1)}× their usual ${m(median)}`,
          facts: { amount: m(t.amount), usualAmount: m(median), multiple: +(t.amount / median).toFixed(1), otherPayments: others.length },
          txnIds: [t.id],
        });
      }
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
