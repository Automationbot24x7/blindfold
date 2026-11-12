// Checks every recorded run: (1) no real name, ID or narration fragment appears in any text that
// left the device, (2) accuracy of the final ledger heads against the samples' known answers.
// Usage: node tools/check-recorded.mjs
import { readFileSync, existsSync } from 'node:fs';

let failed = false;
for (const id of ['cafe', 'hoa', 'rescue']) {
  const file = `public/recorded/${id}.json`;
  if (!existsSync(file)) { console.log(`${id}: no recording`); failed = true; continue; }
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const truth = JSON.parse(readFileSync(`public/samples/${id}.truth.json`, 'utf8'));
  const s = run.snapshot;
  // Only the data lines carry statement content; the fixed instructions and code legend do not.
  const sent = s.ledger.flatMap(l => l.text.split('\n').filter(x => /^(- |r\d+: )/.test(x))).join('\n').toLowerCase();
  // Every counterparty name and every word of 3+ letters in notes that is a person's name must stay home.
  const secrets = new Set();
  for (const t of s.txns) {
    if (t.counterparty) secrets.add(t.counterparty.toLowerCase());
    for (const w of t.counterparty.split(/\s+/)) if (w.length >= 4 && !/^(PAY|SVC|INV|CO|LLC|INC|THE|AND)$/i.test(w)) secrets.add(w.toLowerCase());
    for (const m of t.narration.match(/\d{3}-\d{3}-\d{4}|\b\d{8,}\b|\b[a-z0-9._-]+@[a-z0-9.]+\b/gi) ?? []) secrets.add(m.toLowerCase());
  }
  // Ordinary words that are also part of business names are fine to send (e.g. "pool", "supply").
  const common = new Set(['supply', 'service', 'services', 'security', 'monthly', 'insurance', 'power', 'city', 'deposit', 'settlement', 'payroll', 'premium', 'rent', 'transfer', 'clinic', 'veterinary', 'pool', 'construction', 'properties', 'internet', 'coffee', 'bakery', 'dairy', 'roofing', 'landscaping', 'foundation', 'community', 'donation', 'grant', 'return', 'advance', 'branch', 'cash', 'card', 'purchase', 'check', 'spa', 'academy', 'tuition', 'group', 'linen', 'corner', 'office']);
  const leaks = [...secrets].filter(x => !common.has(x) && new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sent));
  let ok = 0;
  s.txns.forEach((t, i) => { if (t.category === truth[i]) ok++; });
  const byDevice = s.txns.filter(t => t.categorySource === 'device' || t.categorySource === 'memory').length;
  const reviews = s.findings.map(f => `${f.kind}:${f.review?.source ?? 'none'}`).join(' ');
  console.log(`${id}: requests ${s.ledger.length}, leaks ${leaks.length}${leaks.length ? ' -> ' + leaks.join(', ') : ''}; accuracy ${ok}/${s.txns.length}; on device ${byDevice}; guard ${s.guardCatches.length}; ${reviews}`);
  if (leaks.length) failed = true;
}
process.exit(failed ? 1 : 0);
