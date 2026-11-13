// Orchestrates one audit: rules -> on-device labels -> leak guard -> blind cloud review.
// Every byte that leaves the device is recorded in the privacy ledger first.
import { findingPayload, maskedLine, reviewFinding, runSecondOpinion, secondOpinionPayload, type OutgoingPayload } from './cloud';
import { detect, type AuditConfig, type Currency } from './detectors';
import { categoriseOnDevice, leakGuard, type DeviceCall, type PayeeGroup } from './ondevice';
import { rawFound, statementSecrets } from './proof';
import { ruleCategory } from './rules';
import type { Finding, Txn } from './types';
import { residualIdentifiers, Vault } from './vault';

export type Stage = 'idle' | 'rules' | 'device' | 'guard' | 'second-opinion' | 'detect' | 'review' | 'done' | 'error';

export interface LedgerEntry {
  id: number;
  at: string;
  purpose: string;
  text: string; // exactly what was (or would have been) sent
  placeholders: number;
  guardCaught: string[]; // masked by the on-device leak guard before sending
  lastCheck?: string[]; // masked by the last check, just before this request was sent
  status: 'sent' | 'blocked' | 'failed';
  source?: 'in_cloud' | 'on_device';
  model?: string;
  ms?: number;
  error?: string;
}

export interface AuditSnapshot {
  stage: Stage;
  txns: Txn[];
  findings: Finding[];
  ledger: LedgerEntry[];
  deviceCalls: DeviceCall[];
  guardCatches: { text: string; token: string }[];
  message: string;
  deviceMode: 'on-device' | 'cloud-only';
  maskStats?: Record<string, number>; // placeholders created, by type (PERSON, WORD, PHONE ...)
  guardSkipped?: number; // outgoing lines the on-device leak guard could not re-read (they were masked by rules only)
  unlabelled?: number; // payees left for the user to label (cloud limit reached, or the cloud did not answer)
  error?: string;
}

export interface AuditOptions {
  currency: Currency;
  context: string; // e.g. "a small independent café"
  config: AuditConfig;
  cloudModel: string;
  deviceBatchSize: number;
  deviceAvailable: boolean;
  receiptHead: 'SAL' | 'DUE'; // sales for a business, dues for an association or nonprofit
  maxLabelRequests?: number; // cloud requests one audit may spend on labelling payees
  maxReviews?: number; // findings reviewed automatically; the rest wait for a click
  onUpdate: (s: AuditSnapshot) => void;
}

const LABELS_PER_REQUEST = 15;
const payeeKey = (t: Txn) => `${t.direction}:${t.counterpartyKey || t.narration.toUpperCase()}`;

export class Audit {
  readonly vault = new Vault();
  private s: AuditSnapshot;
  private seq = 0;
  /** Every word and number of the raw statement that must stay on this device (see proof.ts). */
  private secrets: Set<string>;

  constructor(txns: Txn[], private o: AuditOptions) {
    this.s = {
      stage: 'idle', txns: txns.map(t => ({ ...t })), findings: [], ledger: [], deviceCalls: [], guardCatches: [],
      message: 'Ready', deviceMode: o.deviceAvailable ? 'on-device' : 'cloud-only',
    };
    this.secrets = statementSecrets(txns);
  }

  get snapshot(): AuditSnapshot { return this.s; }

  private emit(patch: Partial<AuditSnapshot>) {
    this.s = { ...this.s, ...patch, txns: [...this.s.txns] };
    this.o.onUpdate(this.s);
  }

  private setTxn(id: number, patch: Partial<Txn>) {
    const i = this.s.txns.findIndex(t => t.id === id);
    if (i >= 0) this.s.txns[i] = { ...this.s.txns[i], ...patch };
  }

  async run(): Promise<void> {
    try {
      // 1. Rules: obvious rows never touch a model.
      this.emit({ stage: 'rules', message: 'Applying deterministic rules' });
      for (const t of this.s.txns) {
        const r = ruleCategory(t, { receiptHead: this.o.receiptHead });
        if (r) this.setTxn(t.id, { category: r.code, categorySource: 'rule', categoryReason: r.why });
      }
      // Money that goes out and comes back from the same (or a related) party is an advance or
      // loan, whatever the memo says: code pairs the two legs before any model reads them.
      for (const f of detect(this.s.txns, this.o.config).filter(x => x.kind === 'ROUND_TRIP')) {
        for (const id of f.txnIds) this.setTxn(id, { category: 'ADV', categorySource: 'rule', categoryReason: 'paired: the same amount went out and came back' });
      }
      // Register every named party in the vault up front so masking is consistent everywhere.
      for (const t of this.s.txns) {
        if (t.counterparty && t.counterpartyKind !== 'NONE') this.vault.registerParty(t.counterparty, t.counterpartyKind);
      }
      this.emit({});

      // 2. Group the rest by payee so each payee is read once.
      const groups = new Map<string, PayeeGroup>();
      for (const t of this.s.txns.filter(x => !x.category)) {
        const key = payeeKey(t);
        const g = groups.get(key) ?? { key, direction: t.direction, txns: [] };
        g.txns.push(t);
        groups.set(key, g);
      }

      if (this.o.deviceAvailable) {
        this.emit({ stage: 'device', message: `Reading ${groups.size} payees on this device` });
        // A batch the on-device model cannot answer is not fatal: its payees become "unsure" and
        // get a blind second opinion instead (masked, like everything else that leaves).
        await categoriseOnDevice([...groups.values()], this.o.currency, this.o.context, (batch, codes, call) => {
          batch.forEach((g, k) => g.txns.forEach((t, j) => this.setTxn(t.id, {
            category: codes[k] === 'UNS' ? undefined : codes[k],
            unsure: codes[k] === 'UNS',
            categorySource: codes[k] === 'UNS' ? 'none' : j === 0 ? 'device' : 'memory',
            categoryReason: codes[k] === 'UNS' ? (call.failed ? 'the on-device model did not answer' : 'device was unsure') : j === 0 ? 'read on device' : 'same payee as an earlier row',
          })));
          this.emit({ deviceCalls: [...this.s.deviceCalls, call] });
        }, this.o.deviceBatchSize);
      } else {
        // Cloud-only mode (no on-device model): every remaining row is unsure and goes out masked.
        for (const g of groups.values()) g.txns.forEach(t => this.setTxn(t.id, { unsure: true, categorySource: 'none' }));
        this.emit({});
      }

      // 3. Decide what will leave the device, then let the on-device leak guard re-read it.
      const unsure = this.s.txns.filter(t => t.unsure);
      const prelim = detect(this.s.txns, this.o.config);
      const outgoing = new Map<number, Txn>();
      for (const t of unsure) outgoing.set(t.id, t);
      for (const f of prelim) for (const id of f.txnIds) outgoing.set(id, this.s.txns.find(t => t.id === id)!);
      if (this.o.deviceAvailable && outgoing.size) {
        this.emit({ stage: 'guard', message: 'Leak guard: re-reading everything that would leave this device' });
        const notes = [...new Set([...outgoing.values()].map(t => maskedLine(t, this.vault, this.o.currency)))];
        for (let i = 0; i < notes.length; i += 25) {
          const chunk = notes.slice(i, i + 25);
          let res: Awaited<ReturnType<typeof leakGuard>> | undefined;
          for (let attempt = 0; attempt < 2 && !res; attempt++) {
            try { res = await leakGuard(chunk.join('\n')); } catch { /* one more try, then carry on without this pass */ }
          }
          if (!res) {
            // The guard is a second pair of eyes; rules already masked these lines, and the last
            // check before sending still applies. Say so on the receipt rather than stop the audit.
            this.emit({
              guardSkipped: (this.s.guardSkipped ?? 0) + chunk.length,
              deviceCalls: [...this.s.deviceCalls, { purpose: 'Leak guard: re-read outgoing text', rows: chunk.length, ms: 0, source: 'none', failed: 'the on-device model did not answer' }],
            });
            continue;
          }
          const { hits, call } = res;
          this.emit({ deviceCalls: [...this.s.deviceCalls, { ...call, rows: chunk.length }] });
          if (hits.length) {
            const before = this.vault.size;
            const masked = this.vault.maskExtra(hits.join(' | '), hits);
            const caught = hits.map(h => ({ text: h, token: this.vault.mask(h).text }));
            if (this.vault.size > before || masked.tokens.length) this.emit({ guardCatches: [...this.s.guardCatches, ...caught] });
          }
        }
      }

      // 4. Second opinion on unsure payees (masked, cloud first): one line per payee, not per row,
      //    so as little as possible leaves. One audit may only spend so many requests on this.
      const unsureGroups = new Map<string, Txn[]>();
      for (const t of unsure) unsureGroups.set(payeeKey(t), [...(unsureGroups.get(payeeKey(t)) ?? []), t]);
      const reps = [...unsureGroups.values()];
      const maxRequests = this.o.maxLabelRequests ?? 12;
      let failures = 0, requests = 0, left = 0;
      for (let i = 0; i < reps.length; i += LABELS_PER_REQUEST) {
        const batchGroups = reps.slice(i, i + LABELS_PER_REQUEST);
        if (requests >= maxRequests || failures >= 2) { left += batchGroups.length; continue; }
        requests++;
        const batch = batchGroups.map(g => this.s.txns.find(x => x.id === g[0].id)!);
        const n = batch.length;
        this.emit({ stage: 'second-opinion', message: `Asking for a blind second opinion on ${n} payee${n === 1 ? '' : 's'}` });
        const payload = secondOpinionPayload(batch, this.vault, this.o.currency, this.o.context, this.o.deviceAvailable);
        const status = await this.send(payload, async p => {
          const r = await runSecondOpinion(p, batch, this.o.cloudModel);
          batchGroups.forEach((g, k) => g.forEach(t => this.setTxn(t.id, {
            category: r.codes[k] === 'UNS' ? 'OTH' : r.codes[k], unsure: false,
            categorySource: r.source === 'on_device' ? 'device' : 'cloud',
            categoryReason: r.source === 'on_device' ? 'cloud unavailable: on-device second pass' : 'blind second opinion (masked)',
          })));
          return { source: r.source, ms: r.ms, model: r.source === 'on_device' ? 'on-device model' : this.o.cloudModel };
        });
        if (status === 'sent') failures = 0;
        else { failures++; left += batchGroups.length; }
      }
      if (left) this.emit({ unlabelled: left });

      // 5. Detection on the final heads. Every number is computed here, by code.
      this.emit({ stage: 'detect', message: 'Checking patterns' });
      const findings = detect(this.s.txns, this.o.config);
      this.emit({ findings });

      // 6. Blind review of each finding, a few at a time, most serious first. Past the limit,
      //    findings wait for a click instead of spending the shared free quota unasked.
      const maxReviews = this.o.maxReviews ?? 12;
      const auto = findings.slice(0, maxReviews);
      this.emit({ stage: 'review', message: `Blind review of ${auto.length} finding${auto.length === 1 ? '' : 's'}` });
      findings.forEach((f, i) => { f.reviewStatus = i < maxReviews ? 'pending' : 'skipped'; });
      this.emit({ findings: [...findings] });
      const queue = [...auto];
      const worker = async () => { for (let f = queue.shift(); f; f = queue.shift()) await this.reviewOne(f); };
      await Promise.all([worker(), worker(), worker()]);
      this.emit({ stage: 'done', message: 'Audit complete', maskStats: this.vault.counts() });
    } catch (e) {
      this.emit({ stage: 'error', error: (e as Error).message, message: 'Stopped' });
    }
  }

  private async reviewOne(f: Finding): Promise<void> {
    const rows = f.txnIds.map(id => this.s.txns.find(t => t.id === id)!);
    const payload = findingPayload(f, rows, this.vault, this.o.currency, this.o.context);
    const status = await this.send(payload, async p => {
      f.sentText = p.text;
      try {
        f.review = await reviewFinding(p, this.o.cloudModel, this.vault);
        f.reviewError = undefined;
      } catch (e) {
        f.reviewError = (e as Error).message;
        throw e;
      }
      return { source: f.review.source, ms: f.review.ms, model: f.review.model };
    });
    f.reviewStatus = status === 'sent' ? 'done' : status;
    this.emit({ findings: [...this.s.findings] });
  }

  /** Review a finding again: an on-device draft once the cloud is back, a failed review, or one left over the limit. */
  async retryReview(id: string): Promise<void> {
    const f = this.s.findings.find(x => x.id === id);
    if (!f || f.reviewStatus === 'pending') return;
    f.reviewStatus = 'pending';
    this.emit({ findings: [...this.s.findings], message: `Asking the cloud: ${f.title}` });
    await this.reviewOne(f);
    this.emit({ message: 'Audit complete', maskStats: this.vault.counts() });
  }

  /**
   * Last check, then send, then record. Anything that still looks like an identifier is masked
   * by pattern, and anything that was read from the statement and is not an everyday word is
   * masked by exact match. If something raw still remains after that, the request is blocked,
   * never sent.
   */
  private async send(
    payload: OutgoingPayload,
    exec: (p: OutgoingPayload) => Promise<{ source: 'in_cloud' | 'on_device'; ms: number; model?: string }>,
  ): Promise<'sent' | 'blocked' | 'failed'> {
    const id = ++this.seq;
    let p = payload;
    if (residualIdentifiers(p.text).length) p = { ...p, text: this.vault.mask(p.text).text };
    const lastCheck = rawFound(p.text, this.secrets);
    if (lastCheck.length) {
      p = { ...p, text: p.text.split('\n').map(line => (/^(- |r\d+: )/.test(line) ? this.vault.maskExtra(line, lastCheck).text : line)).join('\n') };
    }
    const base = { id, at: new Date().toLocaleTimeString(), purpose: payload.purpose, guardCaught: this.s.guardCatches.map(g => g.text), lastCheck };
    // Count distinct placeholders in the data lines only (the fixed instructions contain none).
    const dataLines = p.text.split('\n').filter(x => /^(- |r\d+: )/.test(x)).join('\n');
    const placeholders = new Set(dataLines.match(/\[[A-Z]+_\d+\]/g) ?? []).size;
    if (residualIdentifiers(p.text).length || rawFound(p.text, this.secrets).length) {
      this.emit({ ledger: [...this.s.ledger, { ...base, text: p.text, placeholders, status: 'blocked', error: 'something from the statement was still readable' }] });
      return 'blocked';
    }
    try {
      const r = await exec(p);
      this.emit({ ledger: [...this.s.ledger, { ...base, text: p.text, placeholders, status: 'sent', source: r.source, model: r.model, ms: r.ms }] });
      return 'sent';
    } catch (e) {
      this.emit({ ledger: [...this.s.ledger, { ...base, text: p.text, placeholders, status: 'failed', error: (e as Error).message }] });
      return 'failed';
    }
  }
}
