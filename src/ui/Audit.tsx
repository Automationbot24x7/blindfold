import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { CATEGORIES, codesFor, label } from '../engine/categories';
import { REVIEW_INSTRUCTIONS } from '../engine/cloud';
import { importStatement } from '../engine/csv';
import { money, type Currency } from '../engine/detectors';
import { Audit, type AuditSnapshot, type LedgerEntry, type Stage } from '../engine/pipeline';
import type { Finding, Txn } from '../engine/types';
import { prepareDevice, useDevice, type DeviceStatus } from '../lib/device';
import { appConfig, loadConfig } from '../lib/remoteConfig';
import { setReplaying } from '../lib/replayState';
import { buildFrames, type RecordedRun } from './replay';
import { SAMPLES, type Sample } from './samples';

interface Meta { title: string; context: string; currency: Currency; period?: string; sample?: string; approvalRule: boolean }

const CONTEXTS: { label: string; context: string; approvalRule: boolean }[] = [
  { label: 'A small shop, café or trading business', context: 'a small independent shop or trading business', approvalRule: false },
  { label: 'A homeowners’ or residents’ association', context: 'a residents’ association run by volunteers; payments over the approval limit need committee sign-off', approvalRule: true },
  { label: 'A small nonprofit, club or community group', context: 'a small nonprofit or community group; payments over the approval limit need board sign-off', approvalRule: true },
  { label: 'A freelancer or sole proprietor', context: 'a freelancer or sole proprietor', approvalRule: false },
  { label: 'A small services firm', context: 'a small professional services firm', approvalRule: false },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AuditPage() {
  const device = useDevice();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [snap, setSnap] = useState<AuditSnapshot | null>(null);
  const [tab, setTab] = useState<'findings' | 'ledger' | 'receipt'>('findings');
  const [xray, setXray] = useState<Finding | null>(null);
  const [cloudOnlyOk, setCloudOnlyOk] = useState(false);
  const [askMode, setAskMode] = useState(false);
  const [error, setError] = useState('');
  const [pendingFile, setPendingFile] = useState<{ name: string; text: string } | null>(null);
  const [replay, setReplay] = useState<{ recordedAt: string; machine: string } | null>(null);
  const auditRef = useRef<Audit | null>(null);
  const timers = useRef<number[]>([]);

  const [afterMode, setAfterMode] = useState<(() => void) | null>(null);

  const deviceReady = device.status === 'available';
  const canRun = deviceReady || cloudOnlyOk;
  /** Runs now if this browser can audit; otherwise asks about the masked cloud-only mode first, then runs. */
  const whenReady = (go: () => void) => { if (canRun) go(); else { setAfterMode(() => go); setAskMode(true); } };

  useEffect(() => { setReplaying(!!replay); }, [replay]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); setReplaying(false); }, []);

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    auditRef.current = null;
    setReplay(null);
    setSnap(null);
    setMeta(null);
  }

  async function start(csv: string, m: Meta) {
    setError('');
    try {
      const imported = importStatement(csv);
      const cfg = await loadConfig();
      const currency = imported.currency;
      const config = { ...cfg.audit[currency], approvalLimit: m.approvalRule ? cfg.audit[currency].approvalLimit : 0 };
      const audit = new Audit(imported.txns, {
        currency, context: m.context, config, cloudModel: cfg.cloudModel, deviceBatchSize: cfg.deviceBatchSize,
        deviceAvailable: deviceReady, receiptHead: m.approvalRule ? 'DUE' : 'SAL', onUpdate: setSnap,
      });
      auditRef.current = audit;
      setReplay(null);
      setMeta({ ...m, currency });
      setSnap(audit.snapshot);
      setTab('findings');
      await audit.run();
      // Development only: save this real run so browsers without the on-device model can replay it.
      if (import.meta.env.DEV && location.search.includes('record') && m.sample && audit.snapshot.stage === 'done' && deviceReady) {
        const run: RecordedRun = {
          version: 1, recordedAt: new Date().toISOString(), machine: 'a Windows laptop running desktop Chrome with the on-device model',
          meta: { ...m, currency }, vaultSize: audit.vault.size, snapshot: audit.snapshot,
        };
        await fetch('/__save-run', { method: 'POST', body: JSON.stringify(run) });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runSample(s: Sample) {
    const csv = await (await fetch(`samples/${s.id}.csv`)).text();
    void start(csv, { title: s.title, context: s.context, currency: 'USD', period: s.period, sample: s.id, approvalRule: s.approvalRule });
  }

  async function playRecorded(s: Sample) {
    setError('');
    try {
      const run = (await (await fetch(`recorded/${s.id}.json`)).json()) as RecordedRun;
      const frames = buildFrames(run.snapshot);
      auditRef.current = null;
      setReplay({ recordedAt: run.recordedAt, machine: run.machine });
      setMeta(run.meta);
      setTab('findings');
      setSnap(frames[0].snap);
      let at = 0;
      timers.current = frames.slice(1).map(fr => { at += fr.delay; return window.setTimeout(() => setSnap(fr.snap), at); });
    } catch {
      setError('That recorded run could not be loaded.');
    }
  }

  if (!snap || !meta) {
    return (
      <div className="main start">
        <div className="page-head">
          <div>
            <h1>Start a blind audit</h1>
            <p>Raw rows are read on this computer. The cloud only reviews masked patterns, and every word that leaves is listed on a receipt.</p>
          </div>
        </div>
        {error && <div className="notice warn"><div><h4>Something went wrong</h4><p>{error}</p></div></div>}
        <DropZone onFile={(name, text) => whenReady(() => setPendingFile({ name, text }))} />
        <DeviceStrip status={device.status} progress={device.progress} cloudOnlyOk={cloudOnlyOk} onAskMode={() => setAskMode(true)} onLeaveMode={() => setCloudOnlyOk(false)} />
        <div className="samples-head">
          <h2>Or try a sample statement</h2>
          <span className="muted">Made-up organisations, each with problems planted for the audit to find.</span>
        </div>
        <div className="samples">
          {SAMPLES.map(s => (
            <div key={s.id} className="sample">
              <span className="flag">{s.place}</span>
              <h3>{s.title}</h3>
              <p>{s.blurb}</p>
              <div className="sample-actions">
                {/* the action that works in this browser comes first and filled */}
                {deviceReady ? (
                  <>
                    <button className="btn primary sm" onClick={() => void runSample(s)}>Run on this computer</button>
                    <button className="btn sm" onClick={() => void playRecorded(s)}>Watch a recorded run</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary sm" onClick={() => void playRecorded(s)}>Watch a recorded run</button>
                    <button className="btn sm" onClick={() => whenReady(() => void runSample(s))}>Run on this computer</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="muted fine-print">
          Recorded runs replay real audits made on a laptop whose Chrome has the on-device AI, for browsers that do not have it. They are always labelled.
        </p>
        {/* reCAPTCHA's own badge is hidden (see app.css), so its notice is shown here as its terms require. */}
        <p className="muted fine-print">
          Calls to the cloud model are protected by Firebase App Check with reCAPTCHA. The Google{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> and{' '}
          <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Terms of Service</a> apply.
        </p>
        {pendingFile && (
          <ContextPicker
            name={pendingFile.name}
            onCancel={() => setPendingFile(null)}
            onPick={ctx => { const f = pendingFile; setPendingFile(null); void start(f.text, { title: f.name.replace(/\.csv$/i, ''), context: ctx.context, currency: 'USD', approvalRule: ctx.approvalRule }); }}
          />
        )}
        {askMode && (
          <ModeModal
            canDownload={device.status === 'downloadable'}
            onCancel={() => { setAskMode(false); setAfterMode(null); }}
            onDownload={() => { setAskMode(false); setAfterMode(null); void prepareDevice(); }}
            onAccept={() => { setCloudOnlyOk(true); setAskMode(false); afterMode?.(); setAfterMode(null); }}
          />
        )}
      </div>
    );
  }

  const flagged = new Set(snap.findings.flatMap(f => f.txnIds));
  return (
    <div className="app">
      <Rail snap={snap} currency={meta.currency} recorded={!!replay} />
      <div className="main">
        {replay && (
          <div className="replay-strip no-print">
            
            <span><b>Recorded run.</b> This audit ran for real on {new Date(replay.recordedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })} on {replay.machine}. Nothing is being processed or sent now.</span>
          </div>
        )}
        <div className="page-head">
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.period ? `${meta.period} · ` : ''}{plural(snap.txns.length, 'row')} · {snap.message}</p>
          </div>
          <div className="no-print">
            <button className="btn" onClick={reset}>New statement</button>
          </div>
        </div>
        {snap.error && <div className="notice warn"><div><h4>The audit stopped</h4><p>{snap.error}</p></div></div>}
        <div className="tabs">
          <button className={tab === 'findings' ? 'on' : ''} onClick={() => setTab('findings')}>Findings<span className="count">{snap.findings.length}</span></button>
          <button className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}>Ledger<span className="count">{snap.txns.length}</span></button>
          <button className={tab === 'receipt' ? 'on' : ''} onClick={() => setTab('receipt')}>Privacy receipt<span className="count">{snap.ledger.length}</span></button>
        </div>
        {tab === 'findings' && (
          <FindingsView
            snap={snap} currency={meta.currency} onXray={setXray}
            onRetry={!replay && auditRef.current ? id => void auditRef.current?.retryReview(id) : undefined}
          />
        )}
        {tab === 'ledger' && <LedgerView snap={snap} currency={meta.currency} flagged={flagged} onEdit={(id, code) => {
          const t = snap.txns.find(x => x.id === id);
          if (t) { t.category = code; t.categorySource = 'user'; t.categoryReason = 'set by you'; setSnap({ ...snap, txns: [...snap.txns] }); }
        }} />}
        {tab === 'receipt' && <ReceiptView snap={snap} meta={meta} recorded={!!replay} />}
      </div>
      {xray && <XRay finding={xray} snap={snap} currency={meta.currency} onClose={() => setXray(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ start screen */

function DropZone({ onFile }: { onFile: (name: string, text: string) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const read = (f?: File) => { if (f) void f.text().then(t => onFile(f.name, t)); };
  return (
    <div
      className={`drop-hero${over ? ' over' : ''}`}
      onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files[0]); }}
    >
      <div className="drop-text">
        <h3>Drop a bank statement here</h3>
        <p>A CSV export from your bank. Date, description and debit/credit (or signed amount) columns are found automatically. The file is read in this tab and never uploaded.</p>
      </div>
      <button className="btn primary" onClick={() => input.current?.click()}>Choose a CSV file</button>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e => read(e.target.files?.[0])} />
    </div>
  );
}

function DeviceStrip(p: { status: DeviceStatus; progress: number; cloudOnlyOk: boolean; onAskMode: () => void; onLeaveMode: () => void }) {
  if (p.status === 'available') {
    return <div className="device-strip ok"><span><b>On-device AI ready.</b> Raw rows will only be read by the AI built into this Chrome.</span></div>;
  }
  if (p.status === 'downloading') {
    return (
      <div className="device-strip ok">
        <span style={{ flex: 1 }}><b>Downloading the on-device AI</b> (one time, about 4 GB). Keep this tab open.<span className="progress"><span style={{ width: `${Math.round(p.progress * 100)}%` }} /></span></span>
      </div>
    );
  }
  if (p.cloudOnlyOk) {
    return (
      <div className="device-strip mode">
        <span><b>Masked cloud-only mode.</b> Rows are masked by rules on this computer; only masked lines are labelled in the cloud.</span>
        <button className="link" onClick={p.onLeaveMode}>Turn off</button>
      </div>
    );
  }
  return (
    <div className="device-strip warn">
      <span><b>{p.status === 'downloadable' ? 'The on-device AI is not downloaded yet.' : p.status === 'checking' ? 'Checking for the on-device AI…' : 'This browser has no on-device AI.'}</b>{' '}
        {p.status === 'unavailable' ? 'It needs a recent desktop Chrome. You can still watch a recorded run, or' : 'Download it to run live, or'}{' '}
        <button className="link" onClick={p.onAskMode}>continue in masked cloud-only mode</button>.
      </span>
      {p.status === 'downloadable' && <button className="btn primary sm" onClick={prepareDevice}>Download (about 4 GB)</button>}
    </div>
  );
}

function ModeModal({ onAccept, onCancel, onDownload, canDownload }: { onAccept: () => void; onCancel: () => void; onDownload: () => void; canDownload: boolean }) {
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" style={{ width: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>Run without the on-device AI?</h3><button className="btn sm" onClick={onCancel}>Close</button></div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>Without the AI built into Chrome, Blindfold still never sends a raw statement. Instead:</p>
          <ul className="plain-list">
            <li>Rows are masked on this computer by rules: names, IDs, phone numbers, and every note word that is not an everyday word.</li>
            <li>Those masked lines are labelled in the cloud, so the cloud sees more lines than in the normal mode.</li>
            <li>There is no on-device leak guard. Every request is still listed word for word on the privacy receipt.</li>
          </ul>
          {canDownload && <p style={{ margin: 0 }}>This Chrome can also download the on-device AI (one time, about 4 GB) for the full private mode.</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn" onClick={onCancel}>Cancel</button>
            {canDownload && <button className="btn" onClick={onDownload}>Download the on-device AI</button>}
            <button className="btn primary" onClick={onAccept}>Use masked cloud-only mode</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextPicker({ name, onPick, onCancel }: { name: string; onPick: (c: (typeof CONTEXTS)[number]) => void; onCancel: () => void }) {
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>Whose statement is “{name}”?</h3><button className="btn sm" onClick={onCancel}>Close</button></div>
        <div className="modal-body">
          <p className="muted" style={{ margin: 0 }}>A short description (no names) that helps label rows. It is the only context that travels with masked lines.</p>
          {CONTEXTS.map(c => <button key={c.label} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => onPick(c)}>{c.label}</button>)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ rail */

const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: 'rules', label: 'Rules', hint: 'obvious rows, no AI' },
  { id: 'device', label: 'Read on this device', hint: 'built-in AI reads raw rows' },
  { id: 'guard', label: 'Leak guard', hint: 'device re-reads outgoing text' },
  { id: 'second-opinion', label: 'Blind second opinion', hint: 'masked lines, cloud first' },
  { id: 'detect', label: 'Pattern checks', hint: 'code computes every number' },
  { id: 'review', label: 'Blind review', hint: 'cloud sees shapes, not names' },
  { id: 'done', label: 'Report ready', hint: 'names restored locally' },
];

function Rail({ snap, currency, recorded }: { snap: AuditSnapshot; currency: Currency; recorded: boolean }) {
  const cur = STAGES.map(s => s.id).indexOf(snap.stage === 'error' ? 'done' : snap.stage);
  const n = Math.max(1, snap.txns.length);
  const by = (s: string) => snap.txns.filter(t => t.categorySource === s).length;
  const local = by('rule') + by('device') + by('memory') + by('user');
  const sentLines = snap.ledger.filter(l => l.status === 'sent').reduce((s, l) => s + (l.text.match(/^(- |r\d+: )/gm) ?? []).length, 0);
  const tokens = sentTokens(snap);
  const sent = snap.ledger.filter(l => l.status === 'sent');
  const cloudCalls = sent.filter(l => l.source === 'in_cloud').length;
  const deviceMs = snap.deviceCalls.reduce((s, c) => s + c.ms, 0);
  const here = recorded ? 'on the recording laptop' : 'on this device';
  const finished = snap.stage === 'done';
  return (
    <aside className="rail">
      <h4>Progress</h4>
      {/* while the audit runs every step is listed; once it is done they fold into one line */}
      {finished ? <p className="steps-done">All {STAGES.length} steps done</p> : (
        <ol className="stage-list">
          {STAGES.map((s, i) => {
            const done = i < cur;
            const active = i === cur;
            const skipped = s.id === 'device' && snap.deviceMode === 'cloud-only';
            return (
              <li key={s.id} className={done ? 'done' : active ? 'active' : ''}>
                <span className="ic" />
                <span>{s.label}{(active || skipped) && <small>{skipped ? 'skipped: no on-device AI' : s.hint}</small>}</span>
              </li>
            );
          })}
        </ol>
      )}
      <h4>Where rows were read</h4>
      <div className="meter">
        <div className="bar">
          <span className="m-rule" style={{ width: `${(by('rule') / n) * 100}%` }} />
          <span className="m-device" style={{ width: `${((by('device') + by('memory')) / n) * 100}%` }} />
          <span className="m-cloud" style={{ width: `${(by('cloud') / n) * 100}%` }} />
        </div>
      </div>
      <dl className="kv">
        <div><dt><i className="m-rule" />Rules</dt><dd>{by('rule')}</dd></div>
        <div><dt><i className="m-device" />Built-in AI, {here}</dt><dd>{by('device') + by('memory')}</dd></div>
        <div><dt><i className="m-cloud" />Blind cloud opinion</dt><dd>{by('cloud')}</dd></div>
        <div className="total"><dt>Read locally</dt><dd>{local} of {snap.txns.length}</dd></div>
      </dl>
      <h4>What left {recorded ? 'the laptop' : 'this device'}</h4>
      <dl className="kv">
        <div className="good"><dt>Raw names, IDs, account numbers</dt><dd>0</dd></div>
        <div><dt>Masked lines</dt><dd>{sentLines}</dd></div>
        <div><dt>Placeholders in them</dt><dd>{tokens.all}</dd></div>
        <div><dt>Requests sent</dt><dd>{sent.length}</dd></div>
        <div><dt>Answered by the cloud</dt><dd>{cloudCalls}</dd></div>
        {sent.length > cloudCalls && <div><dt>Cloud too slow: drafted {recorded ? 'on the laptop' : 'here'}</dt><dd>{sent.length - cloudCalls}</dd></div>}
      </dl>
      <p className="rail-foot">
        {plural(snap.deviceCalls.length, 'on-device call')} ({(deviceMs / 1000).toFixed(1)} s) · {currency} thresholds from {appConfig().source === 'remote' ? 'Remote Config' : 'built-in defaults'}
      </p>
    </aside>
  );
}

/* ------------------------------------------------------------------ findings */

const KIND: Record<string, string> = {
  DUPLICATE_PAYMENT: 'Duplicate payment', ROUND_TRIP: 'Money out and back', STRUCTURING: 'Cash just under a threshold',
  SPLIT_PAYMENT: 'Split to stay under a limit', PERSONAL_SPEND: 'Personal spending', AMOUNT_SPIKE: 'Unusual amount',
};
const VERDICT: Record<string, string> = { LIKELY_ISSUE: 'Likely issue', NEEDS_EXPLANATION: 'Ask the client', LIKELY_FINE: 'Probably fine' };
const FACT_LABEL: Record<string, string> = {
  amount: 'Amount', daysApart: 'Days apart', sameInvoiceReference: 'Same invoice reference', payments: 'Payments',
  amountOut: 'Out', amountBack: 'Back', whoSentItBack: 'Sent back by', deposits: 'Deposits', threshold: 'Threshold',
  largest: 'Largest', total: 'Total', spanDays: 'Over (days)', approvalLimit: 'Approval limit', usualAmount: 'Usual amount',
  multiple: 'Times usual', otherPayments: 'Earlier payments',
};

function FindingsView({ snap, currency, onXray, onRetry }: { snap: AuditSnapshot; currency: Currency; onXray: (f: Finding) => void; onRetry?: (id: string) => void }) {
  if (!snap.findings.length) {
    return <div className="notice"><div><h4>{snap.stage === 'done' ? 'No patterns found' : 'Working…'}</h4><p>{snap.stage === 'done' ? 'Nothing in this statement matched a duplicate, round trip, threshold or split pattern.' : 'Findings appear here as soon as code has computed them.'}</p></div></div>;
  }
  const ids = new Set(snap.findings.flatMap(f => f.txnIds));
  const involved = snap.txns.filter(t => ids.has(t.id) && t.direction === 'out').reduce((s, t) => s + t.amount, 0);
  const count = (v: string) => snap.findings.filter(f => f.review?.verdict === v).length;
  const reviewed = snap.findings.filter(f => f.review).length;
  return (
    <>
      <div className="summary">
        <div><b className="num">{money(involved, currency)}</b><span>paid out in flagged rows</span></div>
        <div><b className="risk">{count('LIKELY_ISSUE')}</b><span>likely {count('LIKELY_ISSUE') === 1 ? 'issue' : 'issues'}</span></div>
        <div><b className="warn">{count('NEEDS_EXPLANATION')}</b><span>to ask the client about</span></div>
        <div><b>{reviewed}/{snap.findings.length}</b><span>reviewed blind</span></div>
      </div>
      <div className="findings">
        {snap.findings.map(f => {
          const rows = f.txnIds.map(id => snap.txns.find(t => t.id === id)!).filter(Boolean);
          return (
            <article key={f.id} className={`finding ${f.severity}`}>
              <header>
                <div>
                  <div className="kind">{KIND[f.kind]} · {f.severity} priority</div>
                  <h3>{f.title}</h3>
                </div>
                <span className={`verdict ${f.review ? f.review.verdict : 'pending'}`}>{f.review ? VERDICT[f.review.verdict] : f.reviewStatus === 'failed' ? 'Review failed' : f.reviewStatus === 'blocked' ? 'Blocked' : 'Reviewing…'}</span>
              </header>
              <p className="facts-line">{Object.entries(f.facts).map(([k, v], i) => <span key={k}>{i > 0 && ' · '}{FACT_LABEL[k] ?? k} <b className="num">{String(v)}</b></span>)}</p>
              <table className="mini">
                <tbody>
                  {rows.map(t => (
                    <tr key={t.id}>
                      <td className="num">{t.date}</td>
                      <td>{t.counterparty || t.narration}</td>
                      <td className="muted">{label(t.category)}</td>
                      <td className={`num amt ${t.direction}`}>{t.direction === 'out' ? '−' : '+'}{money(t.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {f.review && (
                <div className="review">
                  <p>{f.review.explanation}</p>
                  <p className="q"><b>Ask the client:</b> {f.review.clientQuestion}</p>
                </div>
              )}
              <footer>
                {f.review && (f.review.source === 'in_cloud'
                  ? <span className="src cloud">Reviewed blind in the cloud · {(f.review.ms / 1000).toFixed(1)} s</span>
                  : <span className="src device" title={f.review.model}>On-device draft{f.review.model?.includes('(') ? ` · ${f.review.model.split('(')[1].replace(')', '')}` : ''}</span>)}
                <span className="src rule">Numbers from code</span>
                <span style={{ flex: 1 }} />
                {onRetry && f.review?.source === 'on_device' && f.reviewStatus !== 'pending' && (
                  <button className="btn sm" onClick={() => onRetry(f.id)}>Ask the cloud again</button>
                )}
                {f.sentText && <button className="btn sm strong" onClick={() => onXray(f)}>See what the cloud saw</button>}
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ x-ray */

export function Masked({ text }: { text: string }) {
  const parts = text.split(/(\[[A-Z]+_\d+\])/g);
  return <>{parts.map((p, i) => (/^\[[A-Z]+_\d+\]$/.test(p) ? <span key={i} className={`token${p.startsWith('[NAME_') ? ' guard' : p.startsWith('[WORD_') ? ' text' : ''}`}>{p}</span> : p))}</>;
}

/**
 * A request exactly as sent, in order. The standing text that is the same in every request (the review
 * instructions, the category list) is folded so the parts that change are easy to read; one click unfolds it.
 */
function Payload({ text }: { text: string }) {
  const parts: { text: string; fixed?: string }[] = [];
  const codes = text.match(/^([\s\S]*?\nCodes:\n)([\s\S]*?)(\n\n[\s\S]*)$/);
  if (text.startsWith(REVIEW_INSTRUCTIONS)) {
    parts.push({ text: REVIEW_INSTRUCTIONS, fixed: 'Standing instructions, the same in every review' }, { text: text.slice(REVIEW_INSTRUCTIONS.length).replace(/^\n+/, '') });
  } else if (codes) {
    parts.push({ text: codes[1] }, { text: codes[2], fixed: 'Category list, the same in every request' }, { text: codes[3].replace(/^\n+/, '') });
  } else {
    parts.push({ text });
  }
  return (
    <div className="payload">
      {parts.map((p, i) => (p.fixed
        ? <details key={i} className="fixed"><summary>{p.fixed}</summary><Masked text={p.text} /></details>
        : <div key={i}><Masked text={p.text} /></div>))}
    </div>
  );
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  const ws = words.filter(w => w && w.length >= 2);
  if (!ws.length) return <>{text}</>;
  const re = new RegExp(`(${ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(re).map((p, i) => (i % 2 ? <span key={i} className="real">{p}</span> : p))}</>;
}

function XRay({ finding, snap, currency, onClose }: { finding: Finding; snap: AuditSnapshot; currency: Currency; onClose: () => void }) {
  const rows = finding.txnIds.map(id => snap.txns.find(t => t.id === id)!).filter(Boolean);
  const words = [...new Set(rows.flatMap(t => [t.counterparty, t.vpa ?? '', ...(t.narration.match(/\b\d{9,}\b|\b[A-Z]{4}0[A-Z0-9]{6}\b|\d{3}-\d{3}-\d{4}/g) ?? [])]).concat(snap.guardCatches.map(g => g.text)))];
  const sent = finding.sentText ?? '';
  const hasText = /\[WORD_\d+\]/.test(sent);
  const hasGuard = /\[NAME_\d+\]/.test(sent);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal xray-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>X-ray: {finding.title}</h3>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          {/* One red line runs through both rows: your computer on its left, the cloud on its right. Read 1, 2, 3, then 4. */}
          <div className="xray-flow">
          <div className="xray">
            <div className="device">
              <div className="label device"><span className="step">1</span>Stays on this device</div>
              <pre>{rows.map(t => (
                <span key={t.id}>{t.date}  {t.direction === 'out' ? 'OUT' : 'IN '}  {money(t.amount, currency)}{'\n'}<Highlight text={t.narration} words={words} />{'\n\n'}</span>
              ))}</pre>
            </div>
            <div className="arrow"><span className="cross">Masked lines →</span></div>
            <div className="cloud">
              <div className="label cloud"><span className="step">2</span>Exactly what was sent</div>
              <Payload text={sent} />
            </div>
          </div>
          {finding.review && (
            <div className="xray">
              <div className="device">
                <div className="label device"><span className="step">4</span>Names put back on this device</div>
                {finding.review.explanation === finding.review.maskedExplanation && finding.review.clientQuestion === finding.review.maskedClientQuestion && (
                  <p className="muted restore-note">This answer used no codes, so there was nothing to put back.</p>
                )}
                <pre>{finding.review.explanation}{'\n\n'}Ask: {finding.review.clientQuestion}</pre>
              </div>
              <div className="arrow"><span className="cross">← Coded answer</span></div>
              <div className="cloud">
                <div className="label cloud"><span className="step">3</span>Answer as it came back</div>
                <pre><Masked text={finding.review.maskedExplanation} />{'\n\n'}Ask: <Masked text={finding.review.maskedClientQuestion} /></pre>
              </div>
            </div>
          )}
          </div>
          <p className="muted legend">
            <span className="real">Outlined</span> text never left this browser. <span className="token">[PERSON_1]</span> placeholders stand in for names and IDs; the table that maps them back exists only in this tab.
            {hasText && <> <span className="token text">[WORD_1]</span> marks a note word that is not an everyday word, masked by default.</>}
            {hasGuard && <> <span className="token guard">[NAME_1]</span> was added by the on-device leak guard.</>}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ledger */

const FLAG: Record<string, string> = {
  DUPLICATE_PAYMENT: 'Paid twice', ROUND_TRIP: 'Round trip', STRUCTURING: 'Just under limit',
  SPLIT_PAYMENT: 'Split payment', PERSONAL_SPEND: 'Personal?', AMOUNT_SPIKE: 'Unusual amount',
};
const SRC: Record<string, { cls: string; text: string }> = {
  rule: { cls: 'rule', text: 'Rule' },
  device: { cls: 'device', text: 'On device' },
  memory: { cls: 'memory', text: 'Same payee' },
  cloud: { cls: 'cloud', text: 'Blind cloud' },
  user: { cls: 'rule', text: 'You' },
  none: { cls: 'none', text: 'Pending' },
};
type LedgerFilter = 'all' | 'flagged' | 'device' | 'rule' | 'cloud' | 'user';

function LedgerView({ snap, currency, flagged, onEdit }: { snap: AuditSnapshot; currency: Currency; flagged: Set<number>; onEdit: (id: number, code: string) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [toast, setToast] = useState('');
  const flagsOf = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const f of snap.findings) for (const id of f.txnIds) m.set(id, [...new Set([...(m.get(id) ?? []), FLAG[f.kind] ?? 'Flagged'])]);
    return m;
  }, [snap.findings]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2600); return () => clearTimeout(id); }, [toast]);
  const rows = snap.txns.filter(t => {
    if (filter === 'flagged' && !flagged.has(t.id)) return false;
    if (filter === 'device' && !(t.categorySource === 'device' || t.categorySource === 'memory')) return false;
    if ((filter === 'rule' || filter === 'cloud' || filter === 'user') && t.categorySource !== filter) return false;
    if (q && !`${t.narration} ${t.counterparty} ${label(t.category)}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const exportCsv = () => {
    const head = ['Date', 'Description', 'Payee', 'Debit', 'Credit', 'Category', 'Labelled by'];
    const lines = snap.txns.map(t => [t.date, t.narration, t.counterparty, t.direction === 'out' ? t.amount.toFixed(2) : '', t.direction === 'in' ? t.amount.toFixed(2) : '', label(t.category), SRC[t.categorySource]?.text ?? '']);
    download('categorised-ledger.csv', [head, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };
  const FILTERS: [LedgerFilter, string][] = [['all', 'All'], ['flagged', 'Flagged'], ['device', 'On device'], ['rule', 'Rules'], ['cloud', 'Blind cloud'], ['user', 'Edited']];
  return (
    <>
      <div className="filterbar no-print">
        <label className="search"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee, description or category" /></label>
        <div className="seg small">
          {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <span className="muted count-note">{plural(rows.length, 'row')}</span>
        <button className="btn sm" onClick={exportCsv}>Export CSV</button>
      </div>
      <table className="ledger">
        <thead><tr><th>Date</th><th>Payee and description</th><th style={{ textAlign: 'right' }}>Out</th><th style={{ textAlign: 'right' }}>In</th><th>Category</th><th>Read by</th></tr></thead>
        <tbody>
          {rows.map((t: Txn) => {
            const s = SRC[t.unsure ? 'none' : t.categorySource] ?? SRC.none;
            return (
              <tr key={t.id} className={flagged.has(t.id) ? 'flagged' : ''}>
                <td className="date">{t.date}</td>
                <td className="narr"><span className="cp">{t.counterparty || '—'}</span>{(flagsOf.get(t.id) ?? []).map(x => <mark key={x}>{x}</mark>)}<span className="raw" title={t.narration}>{t.narration}</span></td>
                <td className="amt">{t.direction === 'out' ? money(t.amount, currency) : ''}</td>
                <td className="amt in">{t.direction === 'in' ? money(t.amount, currency) : ''}</td>
                <td className={t.category && !t.unsure ? 'cat' : undefined}>
                  {t.category && !t.unsure
                    ? <select value={t.category} onChange={e => { onEdit(t.id, e.target.value); setToast(`${t.counterparty || 'Row'} → ${label(e.target.value)}`); }} aria-label="Category">
                        {CATEGORIES.filter(c => codesFor(t.direction).includes(c.code) && c.code !== 'UNS').map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    : <span className="muted">{t.unsure ? 'Unsure' : '—'}</span>}
                </td>
                <td><span className={`src ${s.cls}`} title={t.categoryReason}>{s.text}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="muted" style={{ padding: 16 }}>No rows match.</p>}
      {toast && <div className="toast">Saved: {toast}</div>}
    </>
  );
}

/* ------------------------------------------------------------------ receipt */

function ReceiptView({ snap, meta, recorded }: { snap: AuditSnapshot; meta: Meta; recorded?: boolean }) {
  const sent = snap.ledger.filter(l => l.status === 'sent');
  const tokens = sentTokens(snap);
  const masked = tokens.text + snap.guardCatches.length;
  const summary = useMemo(() => ({
    statement: meta.title, generated: new Date().toISOString(), recordedRunReplay: !!recorded, rows: snap.txns.length,
    rowsReadOnDevice: snap.txns.filter(t => t.categorySource === 'device' || t.categorySource === 'memory').length,
    rowsByRules: snap.txns.filter(t => t.categorySource === 'rule').length,
    requestsSent: sent.length, rawIdentifiersSent: 0, placeholdersSent: tokens.all, unknownNoteWordsMasked: masked,
    requests: snap.ledger.map(l => ({ time: l.at, purpose: l.purpose, status: l.status, ranOn: l.source, model: l.model, placeholders: l.placeholders, text: l.text })),
  }), [snap, meta, sent.length, recorded, tokens.all, masked]);
  return (
    <>
      <div className="receipt-summary">
        <div className="stat zero"><b>0</b><span>raw names, IDs or account numbers sent</span></div>
        <div className="stat"><b>{sent.length}</b><span>{sent.length === 1 ? 'request' : 'requests'} left {recorded ? 'the laptop' : 'this device'}</span></div>
        <div className="stat"><b>{tokens.all}</b><span>placeholders standing in for names and IDs</span></div>
        <div className="stat"><b>{masked}</b><span>{masked === 1 ? 'unknown note word' : 'unknown note words'} masked by default</span></div>
      </div>
      <div className="receipt-actions no-print">
        <button className="btn sm" onClick={() => window.print()}>Print or save as PDF</button>
        <button className="btn sm" onClick={() => download('privacy-receipt.json', JSON.stringify(summary, null, 2), 'application/json')}>Download receipt (JSON)</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {recorded ? 'Recorded run: the requests that left the recording laptop' : 'Every request that left this device'} during the audit of <b>{meta.title}</b>, word for word. Placeholders stand in for people, businesses, phone numbers, payment IDs, account and reference numbers. The table that maps them back to names never left the browser.
      </p>
      {snap.guardCatches.length > 0 && (
        <div className="notice device"><div><h4>The on-device leak guard masked {plural(snap.guardCatches.length, 'more word')}</h4><p>{snap.guardCatches.map(g => `“${g.text}”`).join(', ')} were masked before anything was sent.</p></div></div>
      )}
      {snap.ledger.map((l: LedgerEntry) => (
        <details key={l.id} className="ledger-entry">
          <summary>
            <span className="t">{l.at}</span>
            <span className="p">{l.purpose}</span>
            {l.status === 'sent' && (l.source === 'in_cloud' ? <span className="src cloud">Cloud · {l.model}</span> : <span className="src device">Answered on device</span>)}
            {l.status === 'failed' && <span className="src none">Failed: {l.error?.slice(0, 60)}</span>}
            {l.status === 'blocked' && <span className="src none">Blocked before sending</span>}
            <span className="muted" style={{ fontSize: 12.5 }}>{plural(l.placeholders, 'placeholder')}</span>
          </summary>
          <Payload text={l.text} />
        </details>
      ))}
      {!snap.ledger.length && <p className="muted">Nothing has left {recorded ? 'the laptop' : 'this device'} yet.</p>}
    </>
  );
}

/** Distinct placeholders that appear in the data lines of what actually left the device. */
function sentTokens(snap: AuditSnapshot): { all: number; text: number } {
  const lines = snap.ledger.filter(l => l.status === 'sent').flatMap(l => l.text.split('\n').filter(x => /^(- |r\d+: )/.test(x)));
  const set = new Set(lines.flatMap(x => x.match(/\[[A-Z]+_\d+\]/g) ?? []));
  return { all: set.size, text: [...set].filter(t => t.startsWith('[WORD_') || t.startsWith('[NAME_')).length };
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
