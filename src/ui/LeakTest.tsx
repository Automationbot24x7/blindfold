// "Try to slip a name past it": the masking and the last check before sending, run live on a line the
// visitor types. Plain code only (no model, no network), so it works in any browser. Loaded lazily, so
// the landing page still makes no third-party requests.
import { useMemo, useState } from 'react';
import { counterpartyKey, counterpartyKind, parseNarration } from '../engine/narration';
import { rawFound, statementSecrets } from '../engine/proof';
import type { Txn } from '../engine/types';
import { Vault, type PartyKind } from '../engine/vault';

const PRESETS: [string, string][] = [
  ['A name in the memo', 'INSTANT PAY TO DANIEL REYES MEMO loan for jenny, call 415-555-0143'],
  ['A card ending', 'ZELLE PAYMENT TO TOM BECKET MEMO repaid via card ending 4471'],
  ['A UK transfer', 'FASTER PAYMENT TO MRS A PATEL REF 00918834 deposit for flat 4'],
  ['An Indian UPI line', 'UPI/431298765432/RAMESH KUMAR/ramesh.k@okpnx/school fees aarav'],
];

/** The same one-line shape the app sends: direction, rail, the payee as a code, the note after default-deny masking. */
function masked(t: Txn, vault: Vault): string {
  const who = t.counterparty && t.counterpartyKind !== 'NONE' ? `${vault.registerParty(t.counterparty, t.counterpartyKind as PartyKind)} (${t.counterpartyKind.toLowerCase()})` : '';
  const note = t.note ? vault.maskNote(t.note).text : '';
  return ['OUT $300.00', `via ${t.rail}`, who, note && `note: "${note}"`].filter(Boolean).join(' ');
}

export default function LeakTest() {
  const [line, setLine] = useState(PRESETS[0][1]);
  const [skip, setSkip] = useState(false);
  const r = useMemo(() => {
    const p = parseNarration(line);
    const t: Txn = {
      id: 1, date: '2026-10-12', narration: line, amount: 300, direction: 'out', rail: p.rail, counterparty: p.counterparty,
      counterpartyKey: counterpartyKey(p.counterparty, p.vpa), counterpartyKind: counterpartyKind(p.counterparty, p.rail, p.note),
      vpa: p.vpa, ref: p.ref, note: p.note, categorySource: 'none',
    };
    const secrets = statementSecrets([t]);
    const vault = new Vault();
    // "Skip the masking" sends the raw line, to show the last check stopping it.
    const out = skip ? `OUT $300.00 ${line}` : masked(t, vault);
    const found = rawFound(`- ${out}`, secrets);
    return { out, found, searched: secrets.size };
  }, [line, skip]);
  const parts = r.out.split(/(\[[A-Z]+_\d+\])/g);
  return (
    <section className="sw-leak" id="try">
      <div className="sw-sec-head">
        <span className="n">Try it</span>
        <h2>Try to slip a name past it.</h2>
        <p>Type any bank statement line. This is the same masking and the same last check the audit runs before anything leaves your computer. Plain code, right here in the page: nothing is sent anywhere.</p>
      </div>
      <div className="leak-presets">
        {PRESETS.map(([label, text]) => <button key={label} className={line === text ? 'on' : ''} onClick={() => setLine(text)}>{label}</button>)}
      </div>
      <label className="leak-input">
        <span>A statement line</span>
        <input value={line} onChange={e => setLine(e.target.value)} spellCheck={false} />
      </label>
      <div className="leak-out">
        <div className="leak-col">
          <div className="leak-h">On your computer</div>
          <div className="leak-line">{line || ' '}</div>
        </div>
        <div className="leak-red" aria-hidden />
        <div className="leak-col">
          <div className="leak-h cloud">{skip ? 'What would leave, unmasked' : 'What would leave'}</div>
          <div className="leak-line">{parts.map((p, i) => (/^\[[A-Z]+_\d+\]$/.test(p) ? <span key={i} className="bar static">{p.slice(1, -1)}</span> : p))}</div>
        </div>
      </div>
      <div className={`leak-verdict${r.found.length ? ' stop' : ''}`}>
        {r.found.length
          ? <><b>Stopped before sending.</b> The last check found {r.found.map(w => `“${w}”`).join(', ')} from the line in the request, so nothing would leave.</>
          : <><b>Checked: nothing from the line got through.</b> The request was searched for the {r.searched} names, uncommon words and account-style numbers in this line. None is in it.</>}
        <label className="leak-skip"><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /> Skip the masking, to see the last check stop it</label>
      </div>
    </section>
  );
}
