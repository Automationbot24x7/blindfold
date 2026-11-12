// Held-out test statements: three made-up organisations that appear nowhere else (not in the
// sample statements, not in the prompt's worked examples), with the correct category for every
// row. They were written after the prompts were final and are used only to measure accuracy;
// nothing in the app was tuned on them. Every person and business in them is fictional.
// Usage: node tools/gen-holdout.mjs   (writes eval/holdout/*.csv and *.truth.json)
import { mkdirSync, writeFileSync } from 'node:fs';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const OUT = 'eval/holdout';
mkdirSync(OUT, { recursive: true });
const tools = seed => {
  const r = rng(seed);
  return { cents: (a, b) => Math.round((a + r() * (b - a)) * 100) / 100, digits: n => String(Math.floor(r() * 10 ** n)).padStart(n, '3') };
};
const mmdd = (m, d) => `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;

// ---------------------------------------------------------------- 1. Dental practice, one month
function dental() {
  const { cents, digits } = tools(20260801);
  const m = 8;
  const rows = [];
  for (const d of [3, 7, 10, 14, 17, 21, 24, 28]) rows.push({ day: d, narr: `DEPOSIT CAREPAY SETTLEMENT REF ${digits(8)}`, in: cents(2100, 4800), truth: 'SAL' });
  for (const [d, a] of [[6, 3120.4], [19, 2875], [29, 1990.6]]) rows.push({ day: d, narr: 'ACH CREDIT BAYVIEW DENTAL BENEFITS CLAIMS PMT', in: a, truth: 'SAL' });
  rows.push({ day: 12, narr: 'MOBILE CHECK DEPOSIT', in: 640, truth: 'SAL' });
  rows.push({ day: 31, narr: 'CREDIT INTEREST', in: 4.06, truth: 'INT' });
  rows.push({ day: 4, narr: 'ACH DEBIT PEARLCREST DENTAL SUPPLY INV 4410', out: 2140, truth: 'PUR' });
  rows.push({ day: 5, narr: 'ACH DEBIT PEARLCREST DENTAL SUPPLY INV 4410', out: 2140, truth: 'PUR' }); // planted duplicate
  rows.push({ day: 25, narr: 'ACH DEBIT PEARLCREST DENTAL SUPPLY INV 4478', out: 1980, truth: 'PUR' });
  rows.push({ day: 1, narr: 'ACH DEBIT CEDAR POINT MEDICAL PLAZA RENT SUITE 210', out: 5600, truth: 'RNT' });
  rows.push({ day: 9, narr: 'ACH DEBIT VALLEY ELECTRIC UTIL PMT', out: 488.31, truth: 'UTL' });
  rows.push({ day: 13, narr: 'ACH DEBIT CLEARWAVE FIBER AUTOPAY', out: 129.99, truth: 'UTL' });
  rows.push({ day: 15, narr: 'ACH DEBIT PAYRIGHT PAYROLL NET PAY', out: 14250, truth: 'WAG' });
  rows.push({ day: 31, narr: 'ACH DEBIT PAYRIGHT PAYROLL NET PAY', out: 14390, truth: 'WAG' });
  rows.push({ day: 16, narr: 'ACH DEBIT IRS USATAXPYMT 941 DEPOSIT', out: 4120.77, truth: 'TAX' });
  rows.push({ day: 11, narr: 'ACH DEBIT BAYLINE MUTUAL INSURANCE PREMIUM', out: 690, truth: 'INS' });
  rows.push({ day: 5, narr: `CARD PURCHASE ${mmdd(m, 5)} DENTIFLOW CLOUD MONTHLY`, out: 249, truth: 'SUB' });
  rows.push({ day: 9, narr: `CARD PURCHASE ${mmdd(m, 9)} SMILEFILE IMAGING SOFTWARE`, out: 89, truth: 'SUB' });
  rows.push({ day: 18, narr: 'INSTANT PAY TO MARLOW AND PIKE CPA MEMO Q2 REVIEW', out: 900, truth: 'FEE' });
  rows.push({ day: 20, narr: 'ACH DEBIT SPARKLE OFFICE CLEANING AUG', out: 760, truth: 'SUP' });
  rows.push({ day: 22, narr: 'CHECK 2214 CHAIRSIDE EQUIPMENT REPAIR', out: 435, truth: 'SUP' });
  rows.push({ day: 22, narr: `CARD PURCHASE ${mmdd(m, 22)} PAPERTRAIL STATIONERS`, out: 63.4, truth: 'SUP' });
  rows.push({ day: 2, narr: 'ACH DEBIT FIRSTLINE EQUIPMENT FINANCE PMT 9 OF 48', out: 1310, truth: 'EMI' });
  rows.push({ day: 14, narr: `CARD PURCHASE ${mmdd(m, 14)} ROSEMARY BISTRO`, out: 186.5, truth: 'FOD' });
  rows.push({ day: 20, narr: `CARD PURCHASE ${mmdd(m, 20)} SKYPORT PARKING`, out: 32, truth: 'TRV' });
  rows.push({ day: 31, narr: 'MONTHLY MAINTENANCE FEE', out: 25, truth: 'CHG' });
  rows.push({ day: 26, narr: 'ONLINE TRANSFER TO SAV XXXX5521', out: 5000, truth: 'OWN' });
  rows.push({ day: 16, narr: `CARD PURCHASE ${mmdd(m, 16)} WILLOWBROOK COUNTRY CLUB`, out: 1450, truth: 'DRW' }); // planted personal
  rows.push({ day: 27, narr: `CARD PURCHASE ${mmdd(m, 27)} KIDDO KINGDOM TOYS`, out: 212.8, truth: 'DRW' });
  return finish(rows, 2026, m, 'dental', {
    preamble: [['Brightside Dental Studio PLLC - Business Checking'], ['Account ending 6604'], ['Statement period 08/01/2026 - 08/31/2026'], ['Amounts in USD'], []],
    header: ['Date', 'Description', 'Withdrawals', 'Deposits', 'Balance'],
    opening: 38410.2,
    row: (date, r, bal) => [date, r.narr, r.out ? r.out.toFixed(2) : '', r.in ? r.in.toFixed(2) : '', bal.toFixed(2)],
  });
}

// ---------------------------------------------------------------- 2. Youth soccer club, one quarter
function club() {
  const { cents, digits } = tools(20260701);
  const rows = [];
  for (const [m, d] of [[7, 3], [7, 17], [8, 1], [8, 15], [9, 1], [9, 16]]) rows.push({ month: m, day: d, narr: `DEPOSIT PLAYREG PAYOUT REF ${digits(8)}`, in: cents(1800, 5200), truth: 'DUE' });
  rows.push({ month: 7, day: 21, narr: 'ACH CREDIT HILLSDALE COMMUNITY FOUNDATION GRANT', in: 7500, truth: 'DUE' });
  rows.push({ month: 8, day: 9, narr: 'INSTANT PAY FROM KAREN OKAFOR MEMO DONATION FOR NEW GOALS', in: 250, truth: 'DUE' });
  rows.push({ month: 7, day: 28, narr: 'MOBILE CHECK DEPOSIT', in: 500, truth: 'DUE' });
  rows.push({ month: 9, day: 8, narr: 'MOBILE CHECK DEPOSIT', in: 300, truth: 'DUE' });
  rows.push({ month: 8, day: 23, narr: 'CASH DEPOSIT BRANCH 017 CONCESSION STAND', in: 640, truth: 'CSH' });
  rows.push({ month: 9, day: 20, narr: 'CASH DEPOSIT BRANCH 017 CONCESSION STAND', in: 820, truth: 'CSH' });
  for (const m of [7, 8, 9]) rows.push({ month: m, day: 30, narr: 'CREDIT INTEREST', in: cents(2, 6), truth: 'INT' });
  for (const m of [7, 8, 9]) rows.push({ month: m, day: 5, narr: 'ACH DEBIT RIVERSIDE SPORTS COMPLEX FIELD RENTAL', out: 1800, truth: 'RNT' });
  rows.push({ month: 7, day: 8, narr: 'ACH DEBIT KICKLINE ATHLETIC SUPPLY INV 881', out: 1260, truth: 'PUR' });
  for (const [d, a, n] of [[11, 2400, 3301], [13, 2350, 3302], [15, 2450, 3303]]) rows.push({ month: 8, day: d, narr: `CHECK ${n} KICKLINE ATHLETIC SUPPLY`, out: a, truth: 'PUR', ref: String(n) }); // planted split
  rows.push({ month: 7, day: 14, narr: 'ACH DEBIT GOALPOST EQUIPMENT CO INV 1290', out: 980, truth: 'PUR' });
  rows.push({ month: 7, day: 10, narr: 'ACH DEBIT SHIELDPLUS SPORTS INSURANCE PREMIUM', out: 1480, truth: 'INS' });
  for (const m of [7, 8, 9]) rows.push({ month: m, day: 12, narr: `CARD PURCHASE ${mmdd(m, 12)} CLUBSITE WEB MONTHLY`, out: 29, truth: 'SUB' });
  rows.push({ month: 9, day: 6, narr: `CARD PURCHASE ${mmdd(9, 6)} FIELDSIDE FUEL`, out: 58.2, truth: 'TRV' });
  rows.push({ month: 8, day: 18, narr: `CARD PURCHASE ${mmdd(8, 18)} GOLDEN CRUST PIZZA`, out: 214, truth: 'FOD' });
  rows.push({ month: 8, day: 2, narr: 'INSTANT PAY TO TOM BECKETT MEMO ADVANCE', out: 3000, truth: 'ADV' }); // planted round trip
  rows.push({ month: 8, day: 20, narr: 'INSTANT PAY FROM TOM BECKETT MEMO PAID BACK', in: 3000, truth: 'ADV' });
  rows.push({ month: 9, day: 14, narr: `CARD PURCHASE ${mmdd(9, 14)} HARBOR LIGHTS JEWELRY`, out: 395, truth: 'DRW' }); // planted personal
  for (const m of [7, 8, 9]) rows.push({ month: m, day: 30, narr: 'MONTHLY SERVICE FEE', out: 12, truth: 'CHG' });
  rows.push({ month: 7, day: 30, narr: 'ATM WITHDRAWAL 07/30 #4471', out: 200, truth: 'ATM' });
  return finish(rows, 2026, 7, 'club', {
    preamble: [['Riverbend Youth Soccer Club - Operating Account'], ['Account ending 2209'], ['Statement period 07/01/2026 - 09/30/2026'], ['Amounts in USD'], []],
    header: ['Posting Date', 'Description', 'Debit', 'Credit', 'Balance', 'Check Number'],
    opening: 12950.75,
    row: (date, r, bal) => [date, r.narr, r.out ? r.out.toFixed(2) : '', r.in ? r.in.toFixed(2) : '', bal.toFixed(2), r.ref ?? ''],
  });
}

// ---------------------------------------------------------------- 3. Freelance designer, one month
function designer() {
  const m = 9;
  const rows = [];
  rows.push({ day: 3, narr: 'ACH CREDIT NORTHWIND ARCHITECTS INV 1022', in: 4200, truth: 'SAL' });
  rows.push({ day: 17, narr: 'ACH CREDIT NORTHWIND ARCHITECTS INV 1031', in: 2100, truth: 'SAL' });
  rows.push({ day: 9, narr: 'ACH CREDIT PALISADE BREWING CO INV 1025', in: 1850, truth: 'SAL' });
  rows.push({ day: 12, narr: 'INSTANT PAY FROM JORDAN MILLS MEMO LOGO PROJECT', in: 600, truth: 'SAL' });
  rows.push({ day: 25, narr: 'INSTANT PAY FROM SAMIRA HOLT MEMO WEBSITE MOCKUPS', in: 450, truth: 'SAL' });
  rows.push({ day: 21, narr: 'DEPOSIT PAYSTREAM TRANSFER REF 55120384', in: 980, truth: 'SAL' });
  rows.push({ day: 30, narr: 'CREDIT INTEREST', in: 1.38, truth: 'INT' });
  rows.push({ day: 2, narr: `CARD PURCHASE ${mmdd(m, 2)} PIXELFORGE SUITE MONTHLY`, out: 54.99, truth: 'SUB' });
  rows.push({ day: 3, narr: `CARD PURCHASE ${mmdd(m, 3)} PIXELFORGE SUITE MONTHLY`, out: 54.99, truth: 'SUB' }); // planted duplicate
  rows.push({ day: 4, narr: `CARD PURCHASE ${mmdd(m, 4)} FONTVAULT LICENSE`, out: 120, truth: 'SUB' });
  rows.push({ day: 11, narr: `CARD PURCHASE ${mmdd(m, 11)} CLOUDCRATE STORAGE`, out: 9.99, truth: 'SUB' });
  rows.push({ day: 1, narr: 'ACH DEBIT HIVE COWORK DESK RENT SEPT', out: 425, truth: 'RNT' });
  rows.push({ day: 8, narr: 'ACH DEBIT SKYLINE MOBILE BILL PMT', out: 71.2, truth: 'UTL' });
  rows.push({ day: 10, narr: 'ACH DEBIT HEALTHBRIDGE INDIVIDUAL PLAN PREMIUM', out: 512, truth: 'INS' });
  rows.push({ day: 15, narr: 'ACH DEBIT IRS USATAXPYMT EST TAX Q3', out: 2600, truth: 'TAX' });
  rows.push({ day: 26, narr: 'ONLINE TRANSFER TO CHK XXXX8812', out: 1500, truth: 'OWN' });
  rows.push({ day: 15, narr: `CARD PURCHASE ${mmdd(m, 15)} TECHNOVA STORE #22`, out: 2299, truth: 'PUR' });
  rows.push({ day: 22, narr: 'INSTANT PAY TO LINDEN AND ROWE CPA MEMO QUARTERLY BOOKS', out: 350, truth: 'FEE' });
  rows.push({ day: 18, narr: `CARD PURCHASE ${mmdd(m, 18)} THE COPPER KETTLE`, out: 64.8, truth: 'FOD' });
  rows.push({ day: 19, narr: `CARD PURCHASE ${mmdd(m, 19)} METROLINK TRANSIT`, out: 27.5, truth: 'TRV' });
  rows.push({ day: 23, narr: `CARD PURCHASE ${mmdd(m, 23)} TINY TOTS DAYCARE`, out: 1150, truth: 'DRW' }); // planted personal
  rows.push({ day: 12, narr: 'ATM WITHDRAWAL 09/12 #8812', out: 100, truth: 'ATM' });
  rows.push({ day: 30, narr: 'MONTHLY SERVICE FEE', out: 10, truth: 'CHG' });
  return finish(rows, 2026, m, 'designer', {
    preamble: [['Ivy Lane Design - Business Checking'], ['Account ending 7130'], ['Statement period 09/01/2026 - 09/30/2026'], ['Amounts in USD'], []],
    header: ['Date', 'Description', 'Amount', 'Running Bal.'],
    opening: 6820.4,
    row: (date, r, bal) => [date, r.narr, (r.out ? -r.out : r.in).toFixed(2), bal.toFixed(2)],
  });
}

function finish(rows, year, firstMonth, name, f) {
  for (const r of rows) r.month ??= firstMonth;
  rows.sort((a, b) => a.month - b.month || a.day - b.day || (a.in ? -1 : 1));
  let bal = f.opening;
  const csv = [...f.preamble, f.header];
  const truth = [];
  for (const r of rows) {
    bal += (r.in ?? 0) - (r.out ?? 0);
    csv.push(f.row(`${String(r.month).padStart(2, '0')}/${String(r.day).padStart(2, '0')}/${year}`, r, bal));
    truth.push(r.truth);
  }
  const text = csv.map(row => row.map(c => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
  writeFileSync(`${OUT}/${name}.csv`, text);
  writeFileSync(`${OUT}/${name}.truth.json`, JSON.stringify(truth));
  console.log(`${name}: ${rows.length} rows`);
}

dental();
club();
designer();
