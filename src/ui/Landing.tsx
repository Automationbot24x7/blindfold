import { ArrowRight } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FEED, type FeedRow } from './feed';

// the masking playground loads after the page, so the first screen stays light
const LeakTest = lazy(() => import('./LeakTest'));

/* Placeholder codes have a fixed width per type, so a bar never hints at how long the hidden name is. */
const BAR_W: Record<string, number> = { BUSINESS: 104, PERSON: 84, PHONE: 76, WORD: 68 };
const VISIBLE = 5; // statement lines on screen at once
const FIRST = 4; // open on the money that went out to a person and came back from his company
const STEP_MS = 3400; // a new transaction arrives this often
const HOLD_MS = 8000; // ...except on the opening view, which carries the thread
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
    // The view that opens on the linked pair (out to a person, back from his company) stays up longer.
    const hold = start % FEED.length === FIRST ? HOLD_MS : STEP_MS;
    let t2 = 0;
    const t1 = window.setTimeout(() => {
      setSliding(true);
      t2 = window.setTimeout(() => { setStart(s => s + 1); setSliding(false); }, SLIDE_MS);
    }, hold);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [paused, start]);
  // Absolute positions as keys, so rows already on screen never re-mount (only the new one animates in).
  const rows = Array.from({ length: VISIBLE }, (_, k) => ({ key: start + k, row: FEED[(start + k) % FEED.length], d: start + k - FIRST < VISIBLE ? (start + k - FIRST) * 90 : 0 }));
  return { rows, sliding };
}

/** One statement line: the raw text on the left, the copy the cloud received on the right. */
function Pair({ r, d }: { r: FeedRow; d: number }) {
  const amount = <span className="a">{r.dir === 'IN' ? '+' : '−'}{r.amount}</span>;
  return (
    <div className="cmp-pair" data-link={r.link} style={{ ['--d' as string]: `${d}ms` }}>
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
  // A red thread pinned to the two codes that code on the computer linked (same surname): the names are
  // hidden, the link is not. Drawn whenever both rows are on screen.
  const [thread, setThread] = useState<{ d: string; a: [number, number]; b: [number, number]; key: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const draw = () => {
      const bars = [...el.querySelectorAll<HTMLElement>('.cmp-pair[data-link="rt"] .cmp-row.cloud .bar')];
      if (bars.length < 2) { setThread(null); return; }
      const box = el.getBoundingClientRect();
      // from the bottom of the first code to the top of the second, pinned at both ends
      const [r1, r2] = bars.slice(0, 2).map(b => b.getBoundingClientRect());
      const p: [number, number] = [r1.left - box.left + r1.width / 2, r1.bottom - box.top];
      const q: [number, number] = [r2.left - box.left + r2.width / 2, r2.top - box.top];
      const mid = (p[1] + q[1]) / 2;
      setThread({ d: `M ${p[0]} ${p[1]} C ${p[0] + 14} ${mid}, ${q[0] - 14} ${mid}, ${q[0]} ${q[1]}`, a: p, b: q, key: rows[0].key });
    };
    draw();
    const ro = new ResizeObserver(draw);
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
          {thread && (
            <svg className="cmp-thread" key={thread.key} aria-hidden>
              <path d={thread.d} pathLength={1} />
              <circle cx={thread.a[0]} cy={thread.a[1]} r={4.5} />
              <circle cx={thread.b[0]} cy={thread.b[1]} r={4.5} />
            </svg>
          )}
        </div>
      </div>
      <div className="cmp-foot">
        <span className="mono">hollis-pine-oct.csv · 66 rows · made-up café</span>
        <span aria-hidden />
        <span>Two names, two codes, one red thread: code on your computer saw that <span className="bar static">PERSON_1</span> and <span className="bar static">BUSINESS_12</span> share a surname and sends only that fact, so the cloud can still ask how they are connected. The grey line is the category the on-device AI gave the row.</span>
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
        <p>Small practices need a second pair of eyes on every statement. They cannot afford audit software, and they should not upload a client’s bank data anywhere. So Blindfold splits the work at a privacy boundary, and follows one case all the way through.</p>
      </div>
      {/* The examples are the real lines sent and the real answer returned in the recorded café run (the round trip). */}
      <div className="spine">
        <div className="spine-hd"><span>Your computer</span><span className="ln">Privacy boundary</span><span>The cloud</span></div>
        <div className="spine-row">
          <div className="step">
            <img className="step-art" src="art/step-01.jpg" alt="" loading="lazy" width="132" height="132" />
            <div>
              <h3><span className="n">01</span>Read and check</h3>
              <p>The built-in AI labels every payee. Plain code finds double payments, money that comes back, cash just under a reporting limit, and does every sum. Here it also sees that both names share a surname.</p>
              <div className="snip">12 Oct −$7,500.00 Instant pay to <b>DANIEL REYES</b> · ADVANCE<br />15 Oct +$7,500.00 Wire in from <b>REYES CONSTRUCTION LLC</b> · RETURN <mark>Same surname</mark></div>
            </div>
          </div>
          <div className="spine-ln" />
          <div className="idle">No network call. Stays on your computer.</div>
        </div>
        <div className="spine-row">
          <div className="step">
            <img className="step-art" src="art/step-02.jpg" alt="" loading="lazy" width="132" height="132" />
            <div>
              <h3><span className="n">02</span>Mask, then check again</h3>
              <p>Every name becomes a code that stays the same across the statement. Unknown note words are masked too, the built-in AI re-reads what is about to leave, and code searches it for the statement’s own names.</p>
              <div className="snip"><span className="cap">The lines as sent (category left out)</span>2026-10-12 OUT $7,500.00 via TRANSFER <span className="bar static">PERSON_1</span> (person) note: "ADVANCE"<br />2026-10-15 IN $7,500.00 via WIRE <span className="bar static">BUSINESS_12</span> (business) note: "RETURN"<br /><span className="fact">whoSentItBack: a different party whose name contains the same surname or brand word</span></div>
            </div>
          </div>
          <div className="spine-ln"><span className="cross">Masked lines →</span><span className="cross">← Coded answers</span></div>
          <div className="step">
            <img className="step-art" src="art/step-03.jpg" alt="" loading="lazy" width="132" height="132" />
            <div>
              <h3><span className="n">03</span>Blind review</h3>
              <p>A larger cloud model judges the pattern from codes, amounts, dates and that one fact, and drafts a question for the client. If the cloud is busy or you are offline, the built-in AI drafts it instead, and says so.</p>
              <div className="snip"><span className="cap">Ask the client · the cloud’s question</span>Could you tell me how <span className="bar static">PERSON_1</span> and <span className="bar static">BUSINESS_12</span> are connected, and what this advance and return were for?</div>
            </div>
          </div>
        </div>
        <div className="spine-row">
          <div className="step">
            <img className="step-art" src="art/step-04.jpg" alt="" loading="lazy" width="132" height="132" />
            <div>
              <h3><span className="n">04</span>Names back, receipt ready</h3>
              <p>Your computer puts the names back into every answer and prints a receipt of each word that left, ready to hand to the client.</p>
              <div className="snip"><span className="cap">For the client</span>Could you tell me how <b>DANIEL REYES</b> and <b>REYES CONSTRUCTION LLC</b> are connected, and what this advance and return were for?</div>
            </div>
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
          <p>Finds a supplier paid twice, cash kept just under $10,000, money that leaves and comes back. Chrome’s built-in AI gives every name a code on your computer, the same code every time, so the cloud can judge the pattern without learning whose money it is.</p>
          <div className="sw-ctas">
            <a className="sw-btn" href="#/audit">Run a sample audit <ArrowRight size={17} /></a>
            <a className="sw-link" href="#/how">See how it works</a>
          </div>
        </div>
        <Comparison />
      </section>

      <HowItWorks />

      <Suspense fallback={null}><LeakTest /></Suspense>

      <section className="sw-faq">
        <div className="sw-sec-head"><span className="n">Questions</span><h2>What a careful bookkeeper asks.</h2></div>
        <ol className="faq-list">
          <li><span className="n">01</span><div><h3>Does my client’s statement go to the cloud?</h3><p>No. The raw statement never leaves your computer. Rows are read by the AI inside Chrome, or, if your Chrome does not have it, masked by rules first. Either way only masked lines are sent, and every one is listed on the receipt.</p></div></li>
          <li><span className="n">02</span><div><h3>Can the cloud work out who PERSON_1 is?</h3><p>It sees a code, an amount, a date and a few everyday words. The table that turns codes back into names exists only in your open browser tab.</p></div></li>
          <li><span className="n">03</span><div><h3>How do I know nothing slipped through?</h3><p>You do not have to take the app’s word for it. Before a request is sent, and again when the receipt is drawn, your browser searches it for every name, uncommon word and account-style number in the statement. The receipt shows how many it looked for and how many it found. Amounts, dates and invoice numbers are sent on purpose: they are the pattern the cloud judges.</p></div></li>
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
