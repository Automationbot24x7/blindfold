import { ArrowRight, Building2, Cloud, Cpu, EyeOff, FileCheck2, HandCoins, HeartHandshake, Lock, ScanSearch, ShieldCheck, Sigma, Store } from 'lucide-react';

export function Landing() {
  return (
    <main className="landing">
      <section className="hero">
        <div>
          <div className="eyebrow"><Lock size={15} />Hybrid AI for small-practice bookkeeping</div>
          <h1>The cloud audits your client’s money <span className="band">blindfolded.</span></h1>
          <p className="lede">
            Blindfold reads a bank statement with the AI built into your own Chrome. Names, phone numbers and account numbers never
            leave your computer. The cloud only sees the shape of the money, and reviews it blind.
          </p>
          <div className="ctas">
            <a className="btn primary lg" href="#/audit">Run a sample audit<ArrowRight /></a>
            <a className="btn lg" href="#/how">How it works</a>
          </div>
          <div className="fine">Free and open source. No sign-up. Sample statements are synthetic.</div>
        </div>
        <div className="split-demo" aria-label="Example of what stays on the device and what the cloud sees">
          <div className="side">
            <div className="label device"><Lock size={13} />Stays on your computer</div>
            <div className="line">12 Oct · OUT $7,500.00 · INSTANT PAY TO <span className="real">DANIEL REYES</span> MEMO ADVANCE</div>
            <div className="line">15 Oct · IN&nbsp; $7,500.00 · WIRE IN FROM <span className="real">REYES CONSTRUCTION LLC</span> MEMO RETURN</div>
          </div>
          <div className="arrow"><Cpu size={14} />masked on device · leak guard · placeholders<EyeOff size={14} /></div>
          <div className="side">
            <div className="label cloud"><Cloud size={13} />All the cloud sees</div>
            <div className="line">2026-10-12 OUT $7,500.00 via TRANSFER <span className="token">[PERSON_4]</span> (person) note: “ADVANCE”</div>
            <div className="line">2026-10-15 IN $7,500.00 via WIRE <span className="token">[BUSINESS_9]</span> (business) note: “RETURN”</div>
            <div className="line" style={{ marginTop: 8, color: 'var(--ink)' }}>
              <span className="verdict LIKELY_ISSUE" style={{ marginRight: 8 }}>Likely issue</span>The same $7,500 left and came back from a related company 3 days later.
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Built for the people who can’t paste a statement into a chatbot</h2>
        <p className="sub">Small practices handle other people’s money. They need a second pair of eyes on every statement, but they can’t afford audit software and they shouldn’t upload a client’s raw bank data anywhere.</p>
        <div className="who">
          <div className="card"><Store size={20} color="#0f766e" /><h3>The one-person practice</h3><p>A bookkeeper in a small town keeping the books for thirty shopkeepers, with patchy internet and clients who trust them with everything.</p></div>
          <div className="card"><Building2 size={20} color="#0f766e" /><h3>The volunteer treasurer</h3><p>A homeowners’ association, club or society whose treasurer signs off on vendors and cash dues, and has to show members the accounts are clean.</p></div>
          <div className="card"><HeartHandshake size={20} color="#0f766e" /><h3>The small nonprofit</h3><p>A rescue shelter or community group spending donors’ money, with no finance team and a board that asks questions.</p></div>
        </div>
      </section>

      <section className="section" id="how">
        <h2>How it works</h2>
        <p className="sub">One app, two models, one rule: raw text is only ever read on your device. Everything runs through Firebase AI Logic, which reports for every call where it actually ran.</p>
        <div className="steps">
          <div className="step"><div className="k" style={{ color: 'var(--device)' }}><Cpu size={15} />On device · <code>ONLY_ON_DEVICE</code></div><h3>Read every row locally</h3><p>The model built into Chrome labels each payee. If it is missing, the call fails; it can never quietly fall back to the cloud.</p></div>
          <div className="step"><div className="k"><Sigma size={15} />Plain code</div><h3>Find the patterns</h3><p>Duplicate payments, money that comes back, cash just under a reporting limit, payments split to dodge approval. Every number is computed by code.</p></div>
          <div className="step"><div className="k" style={{ color: 'var(--device)' }}><ShieldCheck size={15} />On device · leak guard</div><h3>Re-read before anything leaves</h3><p>Names are swapped for placeholders. Then the on-device model reads the outgoing text again and masks anything the rules missed.</p></div>
          <div className="step"><div className="k" style={{ color: 'var(--cloud)' }}><Cloud size={15} />Cloud first · <code>PREFER_IN_CLOUD</code></div><h3>Blind review</h3><p>A larger cloud model judges each pattern from placeholders, amounts and dates. If the cloud is busy or you are offline, the device drafts it and says so.</p></div>
          <div className="step"><div className="k" style={{ color: 'var(--device)' }}><Lock size={15} />On device</div><h3>Names come back locally</h3><p>Answers return with placeholders. Your browser swaps the real names back in; the mapping never leaves the tab.</p></div>
          <div className="step"><div className="k"><FileCheck2 size={15} />Proof</div><h3>A privacy receipt for the client</h3><p>Every request that left the device, word for word, ready to print. Thresholds and model names live in Remote Config; App Check guards the cloud.</p></div>
        </div>
      </section>

      <section className="section">
        <h2>Questions a careful bookkeeper asks</h2>
        <div className="faq" style={{ marginTop: 24 }}>
          <div><h4>Does my client’s statement go to the cloud?</h4><p>No. Raw rows are read by the model inside Chrome on your computer. Only masked lines (placeholders, amounts, dates, short notes) go to the Gemini API through Firebase AI Logic, and each request is listed in the receipt.</p></div>
          <div><h4>Can the cloud work out who [PERSON_4] is?</h4><p>It sees a placeholder, an amount, a date and a few words of note. The table that maps placeholders to names exists only in your open browser tab.</p></div>
          <div><h4>What if my Chrome has no on-device model?</h4><p>The audit page offers to download it (about 4 GB, once). Or you can choose a weaker cloud-only mode that masks rows by rules and tells you before sending.</p></div>
          <div><h4>Can I trust the AI’s arithmetic?</h4><p>The models never calculate. Totals, day gaps and thresholds come from code; the models only label rows and explain patterns code has already measured.</p></div>
          <div><h4>Which statements work?</h4><p>CSV exports from most banks, with Date, Narration or Description, and Withdrawal and Deposit (or a signed Amount) columns. US, UK, European and Indian layouts are detected.</p></div>
          <div><h4>What does it cost?</h4><p>Nothing. The private part runs free on your own machine, and the cloud part fits in the free tier. The code is open source under Apache-2.0.</p></div>
        </div>
      </section>

      <section className="section" style={{ textAlign: 'center' }}>
        <a className="btn primary lg" href="#/audit"><HandCoins />Try it on a sample statement</a>
        <p className="muted" style={{ marginTop: 12 }}><ScanSearch size={14} style={{ verticalAlign: '-2px' }} /> Three made-up statements, each with planted problems for the audit to find.</p>
      </section>

      <footer className="footer">
        <span>Blindfold · open source · built with Firebase AI Logic hybrid inference</span>
        <span>All sample names and businesses are fictional.</span>
      </footer>
    </main>
  );
}
