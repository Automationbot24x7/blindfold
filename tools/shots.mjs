// Full-size screenshots of every screen, using headless Chrome over the DevTools protocol (no deps).
// The audit screens are captured from a recorded run (replay), so no on-device model is needed.
// Usage: node tools/shots.mjs [baseUrl] [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = path.resolve(process.argv[3] ?? '_notes/shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
const W = 1440, H = 900;
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-shots-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(250); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

async function go(url, wait = 1500) {
  await send('Page.navigate', { url });
  await sleep(wait);
}
async function shot(name, { full = false } = {}) {
  let clip;
  if (full) {
    const h = await evaluate('Math.ceil(document.documentElement.scrollHeight)');
    clip = { x: 0, y: 0, width: W, height: Math.min(h, 6000), scale: 1 };
  }
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
}
const click = sel => evaluate(`(() => { const el = ${sel}; if (!el) return false; el.click(); return true; })()`);

// Landing.
await go(`${BASE}/#/`, 2500);
await shot('01-landing-hero');
await shot('02-landing-full', { full: true });

// Audit start screen.
await go(`${BASE}/#/audit`, 2000);
await shot('03-audit-start');

// Replay the café recording and capture each view.
await click(`[...document.querySelectorAll('.sample')][0].querySelectorAll('.btn')[1]`);
await sleep(3500);
await shot('04-replay-in-progress');
for (let i = 0; i < 40; i++) { if ((await evaluate(`document.querySelector('.page-head p')?.innerText || ''`)).includes('complete')) break; await sleep(500); }
await evaluate('window.scrollTo(0,0)');
await shot('05-findings');
await shot('06-findings-full', { full: true });
await click(`[...document.querySelectorAll('.finding')].find(f => /came back/.test(f.innerText))?.querySelector('.foot .btn')`);
await sleep(800);
await shot('07-xray');
await click(`document.querySelector('.modal-head .btn')`);
await click(`[...document.querySelectorAll('.tabs button')].find(b => b.innerText.startsWith('Ledger'))`);
await sleep(600);
await shot('08-ledger');
await click(`[...document.querySelectorAll('.tabs button')].find(b => b.innerText.startsWith('Privacy'))`);
await sleep(600);
await evaluate(`document.querySelector('.ledger-entry')?.setAttribute('open', '')`);
await sleep(300);
await shot('09-receipt');

chrome.kill();
process.exit(0);
