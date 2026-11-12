import {
  AlertTriangle, ArrowRight, Check, CircleDashed, Cloud, Cpu, Download, Eye, FileDown, FileUp, Flag, Loader2,
  Lock, Printer, ScanSearch, ShieldCheck, Sparkles, Upload,
} from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { CATEGORIES, codesFor, label } from '../engine/categories';
import { importStatement } from '../engine/csv';
import { money, type Currency } from '../engine/detectors';
import { Audit, type AuditSnapshot, type LedgerEntry, type Stage } from '../engine/pipeline';
import type { Finding, Txn } from '../engine/types';
import { prepareDevice, useDevice } from '../lib/device';
import { appConfig, loadConfig } from '../lib/remoteConfig';
import { SAMPLES, type Sample } from './samples';

interface Meta { title: string; context: string; currency: Currency; period?: string; sample?: Sample['id']; approvalRule: boolean }

const CONTEXTS: { label: string; context: string; approvalRule: boolean }[] = [
  { label: 'A small shop, café or trading business', context: 'a small independent shop or trading business', approvalRule: false },
  { label: 'A homeowners’ or residents’ association', context: 'a residents’ association run by volunteers; payments over the approval limit need committee sign-off', approvalRule: true },
  { label: 'A small nonprofit, club or community group', context: 'a small nonprofit or community group; payments over the approval limit need board sign-off', approvalRule: true },
  { label: 'A freelancer or sole proprietor', context: 'a freelancer or sole proprietor', approvalRule: false },
  { label: 'A small services firm', context: 'a small professional services firm', approvalRule: false },
];

export function AuditPage() {
  const device = useDevice();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [snap, setSnap] = useState<AuditSnapshot | null>(null);
  const [tab, setTab] = useState<'findings' | 'ledger' | 'receipt'>('findings');
  const [xray, setXray] = useState<Finding | null>(null);
  const [cloudOnlyOk, setCloudOnlyOk] = useState(false);
  const [error, setError] = useState('');
  const [pendingFile, setPendingFile] = useState<{ name: string; text: string } | null>(null);
  const auditRef = useRef<Audit | null>(null);

  const deviceReady = device.status === 'available';
  const canRun = deviceReady || cloudOnlyOk;

  async function start(csv: string, m: Meta) {
    setError('');
    try {
      const imported = importStatement(csv);
      const cfg = await loadConfig();
      const currency = imported.currency;
      const config = { ...cfg.audit[currency], approvalLimit: m.approvalRule ? cfg.audit[currency].approvalLimit : 0 };
      const audit = new Audit(imported.txns, {
        currency, context: m.context, config, cloudModel: cfg.cloudModel,
        deviceBatchSize: cfg.deviceBatchSize, deviceAvailable: deviceReady, onUpdate: setSnap,
      });
      auditRef.current = audit;
      setMeta({ ...m, currency });
      setSnap(audit.snapshot);
      setTab('findings');
      void audit.run();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runSample(s: Sample) {
    const csv = await (await fetch(`samples/${s.id}.csv`)).text();
    void start(csv, { title: s.title, context: s.context, currency: 'USD', period: s.period, sample: s.id, approvalRule: s.approvalRule });
  }

  if (!snap || !meta) {
    return (
      <div className="main" style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div className="page-head">
          <div>
            <h1>Start a blind audit</h1>
            <p>Pick a sample statement or drop in your own CSV. Raw rows are read on this computer; the cloud only reviews masked patterns.</p>
          </div>
        </div>
        <DeviceNotice deviceStatus={device.status} progress={device.progress} cloudOnlyOk={cloudOnlyOk} setCloudOnlyOk={setCloudOnlyOk} />
        {error && <div className="notice warn"><AlertTriangle /><div><h4>Could not read that file</h4><p>{error}</p></div></div>}
        <div className="samples">
          {SAMPLES.map(s => (
            <button key={s.id} className="sample" disabled={!canRun} onClick={() => void runSample(s)}>
              <span className="flag">{s.place}</span>
              <h3>{s.title}</h3>
              <p>{s.blurb}</p>
              <span className="meta"><span className="pill">{s.period}</span><span className="pill">Synthetic sample</span></span>
            </button>
          ))}
        </div>
        <DropZone disabled={!canRun} onFile={(name, text) => setPendingFile({ name, text })} />
        {pendingFile && (
          <ContextPicker
            name={pendingFile.name}
            onCancel={() => setPendingFile(null)}
            onPick={ctx => { const f = pendingFile; setPendingFile(null); void start(f.text, { title: f.name.replace(/\.csv$/i, ''), context: ctx.context, currency: 'USD', approvalRule: ctx.approvalRule }); }}
          />
        )}
        <p className="muted" style={{ fontSize: 13, marginTop: 18 }}>
          Every person and business in the samples is made up. Your own file never leaves this browser: only masked lines are sent for review, and each one is listed in the privacy receipt.
        </p>
      </div>
    );
  }

  const flagged = new Set(snap.findings.flatMap(f => f.txnIds));
  return (
    <div className="app">
      <Rail snap={snap} vaultSize={auditRef.current?.vault.size ?? 0} currency={meta.currency} />
      <div className="main">
        <div className="page-head">
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.period ? `${meta.period} · ` : ''}{snap.txns.length} rows · {snap.message}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }} className="no-print">
            <button className="btn" onClick={() => { setSnap(null); setMeta(null); }}><Upload />New statement</button>
          </div>
        </div>
        {snap.error && <div className="notice warn"><AlertTriangle /><div><h4>The audit stopped</h4><p>{snap.error}</p></div></div>}
        <div className="tabs">
          <button className={tab === 'findings' ? 'on' : ''} onClick={() => setTab('findings')}><Flag size={15} />Findings<span className="count">{snap.findings.length}</span></button>
          <button className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}><ScanSearch size={15} />Ledger<span className="count">{snap.txns.length}</span></button>
          <button className={tab === 'receipt' ? 'on' : ''} onClick={() => setTab('receipt')}><ShieldCheck size={15} />Privacy receipt<span className="count">{snap.ledger.length}</span></button>
        </div>
        {tab === 'findings' && <FindingsView snap={snap} currency={meta.currency} onXray={setXray} />}
        {tab === 'ledger' && <LedgerView snap={snap} currency={meta.currency} flagged={flagged} onEdit={(id, code) => {
          const t = snap.txns.find(x => x.id === id);
          if (t) { t.category = code; t.categorySource = 'user'; t.categoryReason = 'set by you'; setSnap({ ...snap, txns: [...snap.txns] }); }
        }} />}
        {tab === 'receipt' && <ReceiptView snap={snap} meta={meta} vaultSize={auditRef.current?.vault.size ?? 0} />}
      </div>
      {xray && <XRay finding={xray} snap={snap} currency={meta.currency} onClose={() => setXray(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ import helpers */

function DeviceNotice(p: { deviceStatus: string; progress: number; cloudOnlyOk: boolean; setCloudOnlyOk: (b: boolean) => void }) {
  if (p.deviceStatus === 'available') {
    return (
      <div className="notice device"><Cpu /><div><h4>On-device AI is ready</h4><p>Raw statement rows will be read by the model built into this Chrome, through Firebase AI Logic in on-device-only mode. Nothing raw is sent anywhere.</p></div></div>
    );
  }
  if (p.deviceStatus === 'downloading') {
    return (
      <div className="notice device"><Loader2 className="spin" /><div style={{ flex: 1 }}><h4>Downloading the on-device model</h4><p>Chrome is fetching its built-in model (one time, about 4 GB). You can keep this tab open.</p><div className="progress"><span style={{ width: `${Math.round(p.progress * 100)}%` }} /></div></div></div>
    );
  }
  return (
    <div className="notice warn">
      <AlertTriangle />
      <div>
        <h4>{p.deviceStatus === 'downloadable' ? 'The on-device model is not downloaded yet' : 'This browser has no on-device model'}</h4>
        <p>
          Blindfold reads raw rows only with the model built into Chrome on desktop. {p.deviceStatus === 'downloadable'
            ? 'Chrome can download it now (one time, about 4 GB).'
            : 'It needs a recent desktop Chrome with enough disk space and memory.'} Without it you can still run a weaker, cloud-only mode: rows are masked by rules only, and the masked lines are sent for labelling.
        </p>
        <div className="actions">
          {p.deviceStatus === 'downloadable' && <button className="btn primary sm" onClick={prepareDevice}><Download />Download the on-device model</button>}
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={p.cloudOnlyOk} onChange={e => p.setCloudOnlyOk(e.target.checked)} />
            Use cloud-only mode: send rule-masked lines
          </label>
        </div>
      </div>
    </div>
  );
}

function DropZone({ onFile, disabled }: { onFile: (name: string, text: string) => void; disabled: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const read = (f?: File) => { if (f) void f.text().then(t => onFile(f.name, t)); };
  return (
    <div
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); if (!disabled) read(e.dataTransfer.files[0]); }}
    >
      <FileUp size={22} />
      <p><b>Your own statement:</b> drop a bank CSV export here. Columns like Date, Narration or Description, Withdrawal or Debit, Deposit or Credit are detected automatically.</p>
      <div style={{ flex: 1 }} />
      <button className="btn" disabled={disabled} onClick={() => input.current?.click()}>Choose CSV</button>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e => read(e.target.files?.[0])} />
    </div>
  );
}

function ContextPicker({ name, onPick, onCancel }: { name: string; onPick: (c: (typeof CONTEXTS)[number]) => void; onCancel: () => void }) {
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>Whose statement is “{name}”?</h3></div>
        <div className="modal-body">
          <p className="muted" style={{ margin: 0 }}>This short description (no names) helps the models label rows. It is the only context that travels with masked lines.</p>
          {CONTEXTS.map(c => <button key={c.label} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => onPick(c)}>{c.label}<ArrowRight /></button>)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ rail */

const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: 'rules', label: 'Rules', hint: 'obvious rows, no model' },
  { id: 'device', label: 'Read on this device', hint: 'on-device model, raw text' },
  { id: 'guard', label: 'Leak guard', hint: 'device re-reads outgoing text' },
  { id: 'second-opinion', label: 'Blind second opinion', hint: 'masked lines, cloud first' },
  { id: 'detect', label: 'Pattern checks', hint: 'code computes every number' },
  { id: 'review', label: 'Blind review', hint: 'cloud sees shapes, not names' },
  { id: 'done', label: 'Report ready', hint: 'names restored locally' },
];

function Rail({ snap, vaultSize, currency }: { snap: AuditSnapshot; vaultSize: number; currency: Currency }) {
  const order = STAGES.map(s => s.id);
  const cur = order.indexOf(snap.stage === 'error' ? 'done' : snap.stage);
  const n = snap.txns.length;
  const by = (s: string) => snap.txns.filter(t => t.categorySource === s).length;
  const sentLines = snap.ledger.filter(l => l.status === 'sent').reduce((s, l) => s + (l.text.match(/^(- |r\d+: )/gm) ?? []).length, 0);
  const cloudCalls = snap.ledger.filter(l => l.status === 'sent' && l.source === 'in_cloud').length;
  const deviceMs = snap.deviceCalls.reduce((s, c) => s + c.ms, 0);
  return (
    <aside className="rail">
      <h4>Progress</h4>
      <ol className="stage-list">
        {STAGES.map((s, i) => {
          const done = i < cur || snap.stage === 'done';
          const active = i === cur && snap.stage !== 'done';
          const skipped = s.id === 'device' && snap.deviceMode === 'cloud-only';
          return (
            <li key={s.id} className={done ? 'done' : active ? 'active' : ''}>
              <span className="ic">{active ? <Loader2 size={16} className="spin" /> : done ? <Check size={16} color={skipped ? '#9aa0aa' : '#0f766e'} /> : <CircleDashed size={16} />}</span>
              <span>{s.label}<small>{skipped ? 'skipped: no on-device model' : s.hint}</small></span>
            </li>
          );
        })}
      </ol>
      <h4>Where each row was read</h4>
      <div className="meter">
        <div className="bar">
          <span style={{ width: `${(by('rule') / n) * 100}%`, background: '#8a8f99' }} />
          <span style={{ width: `${((by('device') + by('memory')) / n) * 100}%`, background: 'var(--device)' }} />
          <span style={{ width: `${(by('cloud') / n) * 100}%`, background: 'var(--cloud)' }} />
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat"><b>{by('rule')}</b><span>by rules</span></div>
        <div className="stat"><b style={{ color: 'var(--device)' }}>{by('device') + by('memory')}</b><span>on this device</span></div>
        <div className="stat"><b style={{ color: 'var(--cloud)' }}>{by('cloud')}</b><span>blind cloud opinion</span></div>
        <div className="stat"><b>{snap.txns.filter(t => t.unsure).length}</b><span>still unsure</span></div>
      </div>
      <h4>What left this device</h4>
      <div className="stat-grid">
        <div className="stat zero"><b>0</b><span>raw names or IDs</span></div>
        <div className="stat"><b>{sentLines}</b><span>masked lines</span></div>
        <div className="stat"><b>{vaultSize}</b><span>identifiers masked</span></div>
        <div className="stat"><b>{snap.guardCatches.length}</b><span>leak-guard catches</span></div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        {snap.deviceCalls.length} on-device call{snap.deviceCalls.length === 1 ? '' : 's'} ({(deviceMs / 1000).toFixed(1)} s) · {cloudCalls} cloud call{cloudCalls === 1 ? '' : 's'} · {currency} thresholds from {appConfig().source === 'remote' ? 'Remote Config' : 'built-in defaults'}
      </p>
    </aside>
  );
}

/* ------------------------------------------------------------------ findings */

const KIND: Record<string, string> = {
  DUPLICATE_PAYMENT: 'Duplicate payment', ROUND_TRIP: 'Round trip', STRUCTURING: 'Cash just under a threshold',
  SPLIT_PAYMENT: 'Split to stay under a limit', PERSONAL_SPEND: 'Personal spending', AMOUNT_SPIKE: 'Unusual amount',
};
const VERDICT: Record<string, string> = { LIKELY_ISSUE: 'Likely issue', NEEDS_EXPLANATION: 'Ask the client', LIKELY_FINE: 'Probably fine' };

function FindingsView({ snap, currency, onXray }: { snap: AuditSnapshot; currency: Currency; onXray: (f: Finding) => void }) {
  if (!snap.findings.length) {
    return <div className="notice"><Loader2 className={snap.stage === 'done' ? '' : 'spin'} /><div><h4>{snap.stage === 'done' ? 'No patterns found' : 'Working…'}</h4><p>{snap.stage === 'done' ? 'Nothing in this statement matched a duplicate, round trip, threshold or split pattern.' : 'Findings appear here as soon as code has computed them.'}</p></div></div>;
  }
  return (
    <div className="findings">
      {snap.findings.map(f => {
        const rows = f.txnIds.map(id => snap.txns.find(t => t.id === id)!).filter(Boolean);
        return (
          <article key={f.id} className={`finding ${f.severity}`}>
            <div>
              <div className="kind">{KIND[f.kind]} · {f.severity} priority</div>
              <h3>{f.title}</h3>
            </div>
            <span className={`verdict ${f.review ? f.review.verdict : 'pending'}`}>{f.review ? VERDICT[f.review.verdict] : f.reviewStatus === 'failed' ? 'Review failed' : f.reviewStatus === 'blocked' ? 'Blocked' : 'Reviewing…'}</span>
            <div className="facts">
              {Object.entries(f.facts).map(([k, v]) => <span key={k}>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}: <b className="num">{String(v)}</b></span>)}
            </div>
            <div className="facts" style={{ marginTop: 0 }}>
              {rows.map(t => <span key={t.id} className="num">{t.date} · {t.direction === 'out' ? '−' : '+'}{money(t.amount, currency)} · {t.counterparty || t.narration}</span>)}
            </div>
            {f.review && (
              <div className="review">
                <p>{f.review.explanation}</p>
                <p className="q">Ask: “{f.review.clientQuestion}”</p>
              </div>
            )}
            <div className="foot">
              {f.review && (f.review.source === 'in_cloud'
                ? <span className="src cloud"><Cloud />Reviewed in the cloud, blind · {(f.review.ms / 1000).toFixed(1)} s</span>
                : <span className="src device"><Cpu />On-device draft (cloud unavailable)</span>)}
              <span className="src rule"><Sparkles />Numbers computed by code</span>
              {f.sentText && <button className="btn sm" onClick={() => onXray(f)}><Eye />See what the cloud saw</button>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ x-ray */

export function Masked({ text }: { text: string }) {
  const parts = text.split(/(\[[A-Z]+_\d+\])/g);
  return <>{parts.map((p, i) => (/^\[[A-Z]+_\d+\]$/.test(p) ? <span key={i} className={`token${p.startsWith('[NAME_') ? ' guard' : ''}`}>{p}</span> : p))}</>;
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  const ws = words.filter(w => w && w.length >= 2);
  if (!ws.length) return <>{text}</>;
  const re = new RegExp(`(${ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(re).map((p, i) => (i % 2 ? <span key={i} className="real">{p}</span> : p))}</>;
}

function XRay({ finding, snap, currency, onClose }: { finding: Finding; snap: AuditSnapshot; currency: Currency; onClose: () => void }) {
  const rows = finding.txnIds.map(id => snap.txns.find(t => t.id === id)!).filter(Boolean);
  const words = [...new Set(rows.flatMap(t => [t.counterparty, t.vpa ?? '', ...(t.narration.match(/\b\d{9,}\b|\b[A-Z]{4}0[A-Z0-9]{6}\b/g) ?? [])]).concat(snap.guardCatches.map(g => g.text)))];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>X-ray: {finding.title}</h3>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="xray">
            <div>
              <div className="label device"><Lock size={14} />Stays on this device</div>
              <pre>{rows.map(t => (
                <span key={t.id}>{t.date}  {t.direction === 'out' ? 'OUT' : 'IN '}  {money(t.amount, currency)}{'\n'}<Highlight text={t.narration} words={words} />{'\n\n'}</span>
              ))}</pre>
            </div>
            <div>
              <div className="label cloud"><Cloud size={14} />Exactly what was sent</div>
              <pre><Masked text={finding.sentText ?? ''} /></pre>
            </div>
          </div>
          {finding.review && (
            <div className="xray">
              <div>
                <div className="label device"><Lock size={14} />Answer, names restored here</div>
                <pre>{finding.review.explanation}{'\n\n'}Ask: {finding.review.clientQuestion}</pre>
              </div>
              <div>
                <div className="label cloud"><Cloud size={14} />Answer as it came back</div>
                <pre><Masked text={finding.review.maskedExplanation} />{'\n\n'}Ask: <Masked text={finding.review.maskedClientQuestion} /></pre>
              </div>
            </div>
          )}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Highlighted text never left this browser. Dark tokens are placeholders; the table that maps them back to names lives only in this tab’s memory. Green tokens were added by the on-device leak guard.</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ledger */

const SRC: Record<string, { cls: string; icon: ReactNode; text: string }> = {
  rule: { cls: 'rule', icon: <Sparkles />, text: 'Rule' },
  device: { cls: 'device', icon: <Cpu />, text: 'On device' },
  memory: { cls: 'memory', icon: <Cpu />, text: 'Same payee' },
  cloud: { cls: 'cloud', icon: <Cloud />, text: 'Blind cloud' },
  user: { cls: 'rule', icon: <Check />, text: 'You' },
  none: { cls: 'none', icon: <Loader2 />, text: 'Pending' },
};

function LedgerView({ snap, currency, flagged, onEdit }: { snap: AuditSnapshot; currency: Currency; flagged: Set<number>; onEdit: (id: number, code: string) => void }) {
  const exportCsv = () => {
    const head = ['Date', 'Narration', 'Payee', 'Debit', 'Credit', 'Ledger head', 'Labelled by'];
    const lines = snap.txns.map(t => [t.date, t.narration, t.counterparty, t.direction === 'out' ? t.amount.toFixed(2) : '', t.direction === 'in' ? t.amount.toFixed(2) : '', label(t.category), SRC[t.categorySource]?.text ?? '']);
    download('categorised-ledger.csv', [head, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }} className="no-print">
        <button className="btn sm" onClick={exportCsv}><FileDown />Export ledger (CSV)</button>
      </div>
      <table className="ledger">
        <thead><tr><th>Date</th><th>Payee and narration</th><th style={{ textAlign: 'right' }}>Out</th><th style={{ textAlign: 'right' }}>In</th><th>Ledger head</th><th>Read by</th></tr></thead>
        <tbody>
          {snap.txns.map((t: Txn) => {
            const s = SRC[t.unsure ? 'none' : t.categorySource] ?? SRC.none;
            return (
              <tr key={t.id} className={flagged.has(t.id) ? 'flagged' : ''}>
                <td className="date">{t.date}</td>
                <td className="narr"><span className="cp">{t.counterparty || '—'}</span>{flagged.has(t.id) && <Flag size={12} color="#a35a06" style={{ marginLeft: 6 }} />}<span className="raw" title={t.narration}>{t.narration}</span></td>
                <td className="amt">{t.direction === 'out' ? money(t.amount, currency) : ''}</td>
                <td className="amt in">{t.direction === 'in' ? money(t.amount, currency) : ''}</td>
                <td>
                  {t.category && !t.unsure
                    ? <select value={t.category} onChange={e => onEdit(t.id, e.target.value)} aria-label="Ledger head">
                        {CATEGORIES.filter(c => codesFor(t.direction).includes(c.code) && c.code !== 'UNS').map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    : <span className="muted">{t.unsure ? 'Unsure' : '—'}</span>}
                </td>
                <td><span className={`src ${s.cls}`} title={t.categoryReason}>{s.icon}{s.text}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/* ------------------------------------------------------------------ receipt */

function ReceiptView({ snap, meta, vaultSize }: { snap: AuditSnapshot; meta: Meta; vaultSize: number }) {
  const sent = snap.ledger.filter(l => l.status === 'sent');
  const summary = useMemo(() => ({
    statement: meta.title, generated: new Date().toISOString(), rows: snap.txns.length,
    rowsReadOnDevice: snap.txns.filter(t => t.categorySource === 'device' || t.categorySource === 'memory').length,
    rowsByRules: snap.txns.filter(t => t.categorySource === 'rule').length,
    requestsSent: sent.length, rawIdentifiersSent: 0, identifiersMasked: vaultSize, leakGuardCatches: snap.guardCatches.length,
    requests: snap.ledger.map(l => ({ time: l.at, purpose: l.purpose, status: l.status, ranOn: l.source, model: l.model, placeholders: l.placeholders, text: l.text })),
  }), [snap, meta, vaultSize, sent.length]);
  return (
    <>
      <div className="receipt-summary">
        <div className="stat zero"><b>0</b><span>raw names, IDs or account numbers sent</span></div>
        <div className="stat"><b>{sent.length}</b><span>requests left this device</span></div>
        <div className="stat"><b>{vaultSize}</b><span>identifiers replaced by placeholders</span></div>
        <div className="stat"><b>{snap.guardCatches.length}</b><span>extra names caught by the leak guard</span></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }} className="no-print">
        <button className="btn sm" onClick={() => window.print()}><Printer />Print or save as PDF</button>
        <button className="btn sm" onClick={() => download('privacy-receipt.json', JSON.stringify(summary, null, 2), 'application/json')}><FileDown />Download receipt (JSON)</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Every request that left this device during the audit of <b>{meta.title}</b>, with its exact text. Placeholders stand in for people, businesses, phone numbers, UPI IDs, account and reference numbers. The table that maps placeholders back to names never left this browser.
      </p>
      {snap.guardCatches.length > 0 && (
        <div className="notice device"><ShieldCheck /><div><h4>The on-device leak guard caught {snap.guardCatches.length} thing{snap.guardCatches.length === 1 ? '' : 's'} the rules missed</h4><p>{snap.guardCatches.map(g => `“${g.text}”`).join(', ')} were masked before anything was sent.</p></div></div>
      )}
      {snap.ledger.map((l: LedgerEntry) => (
        <details key={l.id} className="ledger-entry">
          <summary>
            <span className="t">{l.at}</span>
            <span className="p">{l.purpose}</span>
            {l.status === 'sent' && (l.source === 'in_cloud' ? <span className="src cloud"><Cloud />Cloud · {l.model}</span> : <span className="src device"><Cpu />Fell back to device</span>)}
            {l.status === 'failed' && <span className="src none">Failed: {l.error?.slice(0, 60)}</span>}
            {l.status === 'blocked' && <span className="src none">Blocked before sending</span>}
            <span className="muted" style={{ fontSize: 12.5 }}>{l.placeholders} placeholders</span>
          </summary>
          <pre><Masked text={l.text} /></pre>
        </details>
      ))}
      {!snap.ledger.length && <p className="muted">Nothing has left this device yet.</p>}
    </>
  );
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
