import { ArrowRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FEED, type FeedRow } from './feed';

/* Placeholder codes have a fixed width per type, so a bar never hints at how long the hidden name is. */
const BAR_W: Record<string, number> = { BUSINESS: 104, PERSON: 84, PHONE: 76, WORD: 68 };
const VISIBLE = 5; // statement lines on screen at once
const FIRST = 0; // start on a line that never leaves, then the double payment
const STEP_MS = 3400; // a new transaction arrives this often
const SLIDE_MS = 520;

function Bar({ code, d }: { code: string; d: number }) {
  const type = code.replace(/[[\]]/g, '').split('_')[0];
  return <span className="bar" style={{ width: BAR_W[type] ?? 84, ['--d' as string]: `${d + 260}ms` }}>{code.replace(/[[\]]/g, '')}</span>;
}

/** Which statement rows are on screen. Every few seconds the top row scrolls away and the next one arrives. */
function useStatementTicker(paused: boolean) {
  const [start, setStart] = useState(FIRST);
  const [sliding, setSliding] = useState(false);
  useEffect(() => {
    if (paused || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let t2 = 0;
    const t1 = window.setInterval(() => {
      setSliding(true);
      t2 = window.setTimeout(() => { setStart(s => s + 1); setSliding(false); }, SLIDE_MS);
    }, STEP_MS);
    return () => { clearInterval(t1); clearTimeout(t2); };
  }, [paused]);
  // Absolute positions as keys, so rows already on screen never re-mount (only the new one animates in).
  const rows = Array.from({ length: VISIBLE }, (_, k) => ({ key: start + k, row: FEED[(start + k) % FEED.length], d: start + k - FIRST < VISIBLE ? (start + k - FIRST) * 90 : 0 }));
  return { rows, sliding };
}

/** One statement line: the raw text on the left, the copy the cloud received on the right. */
function Pair({ r, d }: { r: FeedRow; d: number }) {
  const amount = <span className="a">{r.dir === 'IN' ? '+' : '−'}{r.amount}</span>;
  return (
    <div className="cmp-pair" style={{ ['--d' as string]: `${d}ms` }}>
      <div className="cmp-row">
        <span className="d">{r.date}</span>
        {/* single tokens such as a phone number never break across lines; names wrap between words */}
        <span className="t">{r.segs.map((s, k) => (s.masked ? <b key={k} className={s.raw.includes(' ') ? undefined : 'nb'}>{s.raw}</b> : <span key={k}>{s.raw}</span>))}</span>
        {amount}
      </div>
      <span className="cmp-gap" aria-hidden />
      {r.sent === false ? (
        <div className="cmp-row cloud not-sent">
          <span className="d">{r.date}</span>
          <span className="t">Not sent: nothing to check<span className="lab">{r.head}</span></span>
        </div>
      ) : (
        <div className="cmp-row cloud">
          <span className="d">{r.date}</span>
          <span className="t">
            {r.segs.map((s, k) => (s.masked ? <Bar key={k} code={s.masked} d={d} /> : <span key={k}>{s.raw}</span>))}
            <span className="lab">{r.head}</span>
          </span>
          {amount}
          <span className="f">{r.flag ? <mark style={{ ['--d' as string]: `${d + 520}ms` }}>{r.flag}</mark> : null}</span>
        </div>
      )}
    </div>
  );
}

/** Both sides of the privacy boundary, scrolling through the same statement in step. Hovering pauses it. */
function Comparison() {
  const [paused, setPaused] = useState(false);
  const { rows, sliding } = useStatementTicker(paused);
  const list = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  const [height, setHeight] = useState<number>();
  // The window is exactly as tall as the lines in it; when the top line leaves, the list slides up by its height.
  // Measured again whenever the list changes size (web fonts arriving, a wrapped line, a resized window).
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      setHeight(el.offsetHeight);
      setLift((el.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows[0].key]);
  return (
    <div className="cmp" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="cmp-head">
        <div><span className="n">01</span>Your computer<em>Gemini Nano, built into Chrome</em></div>
        <div className="cmp-line-label">Privacy boundary</div>
        <div><span className="n">02</span>The cloud<em>Gemini 3.5 Flash-Lite, via Firebase AI Logic</em><span className="flags-h">Audit flags</span></div>
      </div>
      <div className="cmp-win" style={{ height }}>
        <div ref={list} className={`cmp-list${sliding ? ' sliding' : ''}`} style={sliding ? { transform: `translateY(-${lift}px)` } : undefined}>
          {rows.map(({ key, row, d }) => <Pair key={key} r={row} d={d} />)}
        </div>
      </div>
      <div className="cmp-foot">
        <span className="mono">hollis-pine-oct.csv · 66 rows · made-up café</span>
        <span aria-hidden />
        <span><span className="bar static">BUSINESS_6</span> = the 6th business in this statement, so a double payment still shows. The grey line is the category the on-device AI gave the row. Enough to judge the pattern, never who it is.</span>
      </div>
    </div>
  );
}

/* "blindfolded." types itself out, then the black bar sweeps in behind it. */
function BlindfoldWord() {
  const word = 'blindfolded.';
  return (
    <span className="bw" aria-label={word}>
      <span className="bw-bg" aria-hidden />
      <span className="bw-text" aria-hidden>{[...word].map((ch, i) => <span key={i} style={{ ['--i' as string]: i }}>{ch}</span>)}</span>
    </span>
  );
}

/* How it works: a swimlane with your computer left of the red line and the cloud right, as in the hero. */
function HowItWorks() {
  return (
    <section className="sw-how" id="how">
      <div className="sw-sec-head">
        <span className="n">How it works</span>
        <h2>Raw text stays on your side of the line.</h2>
        <p>Small practices need a second pair of eyes on every statement. They cannot afford audit software, and they should not upload a client’s bank data anywhere. So Blindfold splits the work at a privacy boundary.</p>
      </div>
      {/* The examples are the real line sent and the real answer returned in the recorded café run. */}
      <div className="spine">
        <div className="spine-hd"><span>Your computer</span><span className="ln">Privacy boundary</span><span>The cloud</span></div>
        <div className="spine-row">
          <div className="step">
            <h3><span className="n">01</span>Read and check</h3>
            <p>The built-in AI labels every payee. Plain code finds double payments, money that comes back, and cash just under a reporting limit, and does every sum.</p>
            <div className="snip">08 Oct −$1,845.00 ACH debit <b>HARBORVIEW BAKERY SUPPLY</b> INV 2231 <mark>Paid twice</mark></div>
          </div>
          <div className="spine-ln" />
          <div className="idle">No network call. Stays on your computer.</div>
        </div>
        <div className="spine-row">
          <div className="step">
            <h3><span className="n">02</span>Mask, then check again</h3>
            <p>Names, account and phone numbers become numbered codes. A note word that is not an everyday word is masked too. The built-in AI re-reads anything about to leave.</p>
            <div className="snip"><span className="cap">The line as sent</span>2026-10-08 OUT $1,845.00 via ACH <span className="bar static">BUSINESS_6</span> (business) note: "INV 2231" category: Purchases &amp; suppliers</div>
          </div>
          <div className="spine-ln"><span className="cross">Masked lines →</span><span className="cross">← Coded answers</span></div>
          <div className="step">
            <h3><span className="n">03</span>Blind review</h3>
            <p>A larger cloud model judges each pattern from codes, amounts and dates, and drafts a question for the client. If the cloud is busy or you are offline, the built-in AI drafts it instead, and says so.</p>
            <div className="snip"><span className="cap">Likely issue · the cloud’s question</span>Did <span className="bar static">BUSINESS_6</span> confirm this second payment of $1,845.00 was a mistake and agree to refund it?</div>
          </div>
        </div>
        <div className="spine-row">
          <div className="step">
            <h3><span className="n">04</span>Names back, receipt ready</h3>
            <p>Your computer puts the names back into every answer and prints a receipt of each word that left, ready to hand to the client.</p>
            <div className="snip"><span className="cap">For the client</span>Did <b>HARBORVIEW BAKERY SUPPLY</b> confirm this second payment of $1,845.00 was a mistake and agree to refund it?</div>
          </div>
          <div className="spine-ln" />
          <div className="idle">No network call. Stays on your computer.</div>
        </div>
      </div>
    </section>
  );
}

export function Landing() {
  return (
    <main className="sw">
      <section className="sw-hero">
        <h1>The cloud audits your client’s money <BlindfoldWord /></h1>
        <div className="sw-intro">
          <p>Chrome’s built-in AI reads the statement on your computer and swaps every name, phone number and account number for a code. Only the masked lines go to the cloud.</p>
          <div className="sw-ctas">
            <a className="sw-btn" href="#/audit">Run a sample audit <ArrowRight size={17} /></a>
            <a className="sw-link" href="#/how">See how it works</a>
          </div>
        </div>
        <Comparison />
      </section>

      <HowItWorks />

      <section className="sw-faq">
        <div className="sw-sec-head"><span className="n">Questions</span><h2>What a careful bookkeeper asks.</h2></div>
        <ol className="faq-list">
          <li><span className="n">01</span><div><h3>Does my client’s statement go to the cloud?</h3><p>No. The raw statement never leaves your computer. Rows are read by the AI inside Chrome, or, if your Chrome does not have it, masked by rules first. Either way only masked lines are sent, and every one is listed on the receipt.</p></div></li>
          <li><span className="n">02</span><div><h3>Can the cloud work out who PERSON_1 is?</h3><p>It sees a code, an amount, a date and a few everyday words. The table that turns codes back into names exists only in your open browser tab.</p></div></li>
          <li><span className="n">03</span><div><h3>How do I know nothing slipped through?</h3><p>You do not have to take the app’s word for it. Before a request is sent, and again when the receipt is drawn, your browser searches it for every name, word and number in the statement that is not an everyday word. The receipt shows how many it looked for and how many it found.</p></div></li>
          <li><span className="n">04</span><div><h3>Can I trust the arithmetic?</h3><p>The AI never calculates. Totals, day gaps and thresholds come from plain code; the AI only labels rows and explains patterns that code has already measured.</p></div></li>
          <li><span className="n">05</span><div><h3>Which statements work?</h3><p>CSV exports from most banks, with or without a header row: a date, a description, and either debit and credit columns or one signed amount. US, UK, European and Indian layouts are worked out from the file; if yours is not, you point at the columns.</p></div></li>
        </ol>
      </section>

      <section className="sw-hood">
        <div className="sw-sec-head"><span className="n">Under the hood</span><h2>One SDK, two models, a hard line between them.</h2><p>Every AI call goes through Firebase AI Logic, which reports where each call actually ran. The app shows it on every row and in the receipt.</p></div>
        <table className="hood">
          <thead><tr><th>Step</th><th>Runs on</th><th>How</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>Label every payee</td><td>Your computer</td><td><code>ONLY_ON_DEVICE</code></td><td>Raw text may only meet the built-in model. With no model the call fails; it can never fall back to the cloud.</td></tr>
            <tr><td>Patterns and numbers</td><td>Plain code</td><td>Deterministic checks</td><td>Double payments, round trips, cash just under a reporting limit, payments split under an approval limit.</td></tr>
            <tr><td>Mask and re-check</td><td>Your computer</td><td>Code vault, default-deny notes, <code>ONLY_ON_DEVICE</code> leak guard, exact-match last check</td><td>Nothing unknown leaves. The built-in model re-reads outgoing text, then code searches it for the statement’s own words; a request that still shows one is stopped.</td></tr>
            <tr className="cloud"><td>Blind review</td><td>The cloud, masked</td><td><code>PREFER_IN_CLOUD</code>, 25 s deadline</td><td>A larger model judges the pattern. Offline or busy, the built-in model drafts it, labelled as a draft.</td></tr>
            <tr><td>Limits and model names</td><td>Firebase</td><td>Remote Config</td><td>Reporting limits, model names and how many cloud requests one audit may use change without a redeploy.</td></tr>
            <tr><td>Abuse protection</td><td>Firebase</td><td>App Check</td><td>Only this app can call the cloud model.</td></tr>
          </tbody>
        </table>
      </section>

      <section className="sw-end">
        <h2>Try it on a made-up statement.</h2>
        <a className="sw-btn" href="#/audit">Run a sample audit <ArrowRight size={17} /></a>
        <p className="foot-note">For one-person bookkeeping practices, volunteer treasurers and small nonprofits. Free and open source; no sign-up. Every person and business in the samples is fictional.</p>
      </section>
      <footer className="sw-footer"><span>Blindfold</span><span>Built with Firebase AI Logic hybrid inference</span></footer>
    </main>
  );
}
