// Orchestrates one audit: rules -> on-device labels -> leak guard -> blind cloud review.
// Every byte that leaves the device is recorded in the privacy ledger first.
import { findingPayload, maskedLine, reviewFinding, runSecondOpinion, secondOpinionPayload, type OutgoingPayload } from './cloud';
import { detect, type AuditConfig, type Currency } from './detectors';
import { categoriseOnDevice, leakGuard, type DeviceCall, type PayeeGroup } from './ondevice';
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
  maskStats?: Record<string, number>; // placeholders created, by type (PERSON, TEXT, PHONE ...)
  error?: string;
}

export interface AuditOptions {
  currency: Currency;
  context: string; // e.g. "a small grocery shop in India"
  config: AuditConfig;
  cloudModel: string;
  deviceBatchSize: number;
  deviceAvailable: boolean;
  receiptHead: 'SAL' | 'DUE'; // sales for a business, dues for an association or nonprofit
  onUpdate: (s: AuditSnapshot) => void;
}

export class Audit {
  readonly vault = new Vault();
  private s: AuditSnapshot;
  private seq = 0;

  constructor(txns: Txn[], private o: AuditOptions) {
    this.s = {
      stage: 'idle', txns: txns.map(t => ({ ...t })), findings: [], ledger: [], deviceCalls: [], guardCatches: [],
      message: 'Ready', deviceMode: o.deviceAvailable ? 'on-device' : 'cloud-only',
    };
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
        if (t.counterparty && (t.counterpartyKind === 'PERSON' || t.counterpartyKind === 'BUSINESS')) this.vault.registerParty(t.counterparty, t.counterpartyKind);
      }
      this.emit({});

      // 2. Group the rest by payee so each payee is read once.
      const groups = new Map<string, PayeeGroup>();
      for (const t of this.s.txns.filter(x => !x.category)) {
        const key = `${t.direction}:${t.counterpartyKey || t.narration.toUpperCase()}`;
        const g = groups.get(key) ?? { key, direction: t.direction, txns: [] };
        g.txns.push(t);
        groups.set(key, g);
      }

      if (this.o.deviceAvailable) {
        this.emit({ stage: 'device', message: `Reading ${groups.size} payees on this device` });
        await categoriseOnDevice([...groups.values()], this.o.currency, this.o.context, (batch, codes, call) => {
          batch.forEach((g, k) => g.txns.forEach((t, j) => this.setTxn(t.id, {
            category: codes[k] === 'UNS' ? undefined : codes[k],
            unsure: codes[k] === 'UNS',
            categorySource: codes[k] === 'UNS' ? 'none' : j === 0 ? 'device' : 'memory',
            categoryReason: codes[k] === 'UNS' ? 'device was unsure' : j === 0 ? 'read on device' : 'same payee as an earlier row',
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
          const { hits, call } = await leakGuard(notes.slice(i, i + 25).join('\n'));
          this.emit({ deviceCalls: [...this.s.deviceCalls, { ...call, rows: Math.min(25, notes.length - i) }] });
          if (hits.length) {
            const before = this.vault.size;
            const masked = this.vault.maskExtra(hits.join(' | '), hits);
            const caught = hits.map(h => ({ text: h, token: this.vault.mask(h).text }));
            if (this.vault.size > before || masked.tokens.length) this.emit({ guardCatches: [...this.s.guardCatches, ...caught] });
          }
        }
      }

      // 4. Second opinion on unsure rows (masked, cloud first).
      for (let i = 0; i < unsure.length; i += 15) {
        const batch = unsure.slice(i, i + 15).map(t => this.s.txns.find(x => x.id === t.id)!);
        this.emit({ stage: 'second-opinion', message: `Asking for a blind second opinion on ${batch.length} unsure row${batch.length === 1 ? '' : 's'}` });
        const payload = secondOpinionPayload(batch, this.vault, this.o.currency, this.o.context);
        await this.send(payload, async p => {
          const r = await runSecondOpinion(p, batch, this.o.cloudModel);
          batch.forEach((t, k) => this.setTxn(t.id, {
            category: r.codes[k] === 'UNS' ? 'OTH' : r.codes[k], unsure: false,
            categorySource: r.source === 'on_device' ? 'device' : 'cloud',
            categoryReason: r.source === 'on_device' ? 'cloud unavailable: on-device second pass' : 'blind second opinion (masked)',
          }));
          return { source: r.source, ms: r.ms, model: r.source === 'on_device' ? 'on-device model' : this.o.cloudModel };
        });
      }

      // 5. Detection on the final heads. Every number is computed here, by code.
      this.emit({ stage: 'detect', message: 'Checking patterns' });
      const findings = detect(this.s.txns, this.o.config);
      this.emit({ findings });

      // 6. Blind review of each finding, a few at a time.
      this.emit({ stage: 'review', message: `Blind review of ${findings.length} finding${findings.length === 1 ? '' : 's'}` });
      findings.forEach(f => { f.reviewStatus = 'pending'; });
      this.emit({ findings: [...findings] });
      const queue = [...findings];
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
      f.review = await reviewFinding(p, this.o.cloudModel, this.vault);
      return { source: f.review.source, ms: f.review.ms, model: f.review.model };
    });
    f.reviewStatus = status === 'sent' ? 'done' : status;
    this.emit({ findings: [...this.s.findings] });
  }

  /** Re-send an on-device draft to the cloud (for example after the laptop is back online). */
  async retryReview(id: string): Promise<void> {
    const f = this.s.findings.find(x => x.id === id);
    if (!f) return;
    f.reviewStatus = 'pending';
    this.emit({ findings: [...this.s.findings], message: `Asking the cloud again: ${f.title}` });
    await this.reviewOne(f);
    this.emit({ message: 'Audit complete' });
  }

  /**
   * Last check, then send, then record. Anything that still looks like an identifier is masked
   * by pattern before sending; if something still remains, the request is blocked, never sent.
   */
  private async send(
    payload: OutgoingPayload,
    exec: (p: OutgoingPayload) => Promise<{ source: 'in_cloud' | 'on_device'; ms: number; model?: string }>,
  ): Promise<'sent' | 'blocked' | 'failed'> {
    const id = ++this.seq;
    const base = { id, at: new Date().toLocaleTimeString(), purpose: payload.purpose, guardCaught: this.s.guardCatches.map(g => g.text) };
    let p = payload;
    if (residualIdentifiers(p.text).length) p = { ...p, text: this.vault.mask(p.text).text };
    // Count distinct placeholders in the data lines only (the fixed instructions contain none).
    const dataLines = p.text.split('\n').filter(x => /^(- |r\d+: )/.test(x)).join('\n');
    const placeholders = new Set(dataLines.match(/\[[A-Z]+_\d+\]/g) ?? []).size;
    if (residualIdentifiers(p.text).length) {
      this.emit({ ledger: [...this.s.ledger, { ...base, text: p.text, placeholders, status: 'blocked', error: 'identifier still visible' }] });
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
