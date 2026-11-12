// Recorded runs: a real audit, recorded on a laptop whose Chrome has the on-device model, can be
// replayed step by step on any browser. Replays are always labelled as recordings in the UI.
import type { Currency } from '../engine/detectors';
import type { AuditSnapshot } from '../engine/pipeline';

export interface RecordedRun {
  version: 1;
  recordedAt: string; // ISO date
  machine: string; // short description of the recording machine
  meta: { title: string; context: string; currency: Currency; period?: string; sample?: string; approvalRule: boolean };
  vaultSize: number;
  snapshot: AuditSnapshot;
}

export interface Frame { delay: number; snap: AuditSnapshot }

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Rebuild the audit's progress from its final state, stage by stage, for an honest replay. */
export function buildFrames(final: AuditSnapshot): Frame[] {
  const f = clone(final);
  const frames: Frame[] = [];
  const base = (): AuditSnapshot => ({ ...f, txns: f.txns.map(t => ({ ...t })), findings: [], ledger: [], deviceCalls: [], guardCatches: [], stage: 'rules', message: 'Applying deterministic rules', error: undefined });

  // 1. Rules only.
  let s = base();
  s.txns = s.txns.map(t => (t.categorySource === 'rule' ? t : { ...t, category: undefined, categorySource: 'none', unsure: false }));
  frames.push({ delay: 700, snap: clone(s) });

  // 2. On-device reading, revealed in as many steps as there were labelling calls.
  const labelCalls = f.deviceCalls.filter(c => !c.purpose.startsWith('Leak guard'));
  const deviceRows = f.txns.filter(t => t.categorySource === 'device' || t.categorySource === 'memory' || t.unsure || t.categorySource === 'cloud');
  const steps = Math.max(1, labelCalls.length);
  for (let i = 0; i < steps; i++) {
    const upto = Math.ceil(((i + 1) / steps) * deviceRows.length);
    const ids = new Set(deviceRows.slice(0, upto).map(t => t.id));
    s = { ...s, stage: 'device', message: `Reading payees on this device (recorded)`, deviceCalls: labelCalls.slice(0, i + 1) };
    s.txns = f.txns.map(t => {
      if (t.categorySource === 'rule') return t;
      if (!ids.has(t.id)) return { ...t, category: undefined, categorySource: 'none', unsure: false };
      // Rows the cloud labelled later were "unsure" after the device pass.
      return t.categorySource === 'cloud' ? { ...t, category: undefined, categorySource: 'none', unsure: true } : t;
    });
    frames.push({ delay: 1100, snap: clone(s) });
  }

  // 3. Leak guard.
  s = { ...s, stage: 'guard', message: 'Leak guard: re-reading everything that would leave this device', deviceCalls: f.deviceCalls, guardCatches: f.guardCatches };
  frames.push({ delay: 1200, snap: clone(s) });

  // 4. Second opinions (their ledger entries are the ones before the first review).
  const secondEntries = f.ledger.filter(l => l.purpose.startsWith('Second opinion'));
  if (secondEntries.length) {
    s = { ...s, stage: 'second-opinion', message: 'Blind second opinion on unsure rows', txns: f.txns.map(t => ({ ...t })), ledger: secondEntries };
    frames.push({ delay: 1100, snap: clone(s) });
  } else {
    s = { ...s, txns: f.txns.map(t => ({ ...t })) };
  }

  // 5. Patterns found by code, reviews pending.
  const pending = f.findings.map(x => ({ ...x, review: undefined, reviewStatus: 'pending' as const }));
  s = { ...s, stage: 'detect', message: 'Checking patterns', findings: pending };
  frames.push({ delay: 900, snap: clone(s) });

  // 6. Reviews arrive one by one, each with its receipt entry.
  const reviewEntries = f.ledger.filter(l => !l.purpose.startsWith('Second opinion'));
  for (let i = 0; i < f.findings.length; i++) {
    s = {
      ...s, stage: 'review', message: `Blind review of ${f.findings.length} findings`,
      findings: f.findings.map((x, k) => (k <= i ? x : pending[k])),
      ledger: [...secondEntries, ...reviewEntries.slice(0, i + 1)],
    };
    frames.push({ delay: 1000, snap: clone(s) });
  }
  frames.push({ delay: 600, snap: clone({ ...f, stage: 'done', message: 'Replay complete' }) });
  return frames;
}
