// Generates the synthetic sample statements (every person and business in them is made up)
// and a ground-truth file with the correct ledger head for every row, used to measure accuracy.
// Usage: node tools/gen-samples.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const OUT = 'public/samples';
mkdirSync(OUT, { recursive: true });
for (const old of ['kirana', 'association']) for (const ext of ['csv', 'truth.json']) rmSync(`${OUT}/${old}.${ext}`, { force: true });

const tools = seed => {
  const r = rng(seed);
  return { between: (a, b) => Math.round(a + r() * (b - a)), cents: (a, b) => Math.round((a + r() * (b - a)) * 100) / 100, digits: n => String(Math.floor(r() * 10 ** n)).padStart(n, '7') };
};

// ---------------------------------------------------------------- 1. Neighborhood café (US)
function cafe() {
  const { between, cents, digits } = tools(20261001);
  const rows = [];
  // Card sales settled daily by the (made-up) card processor.
  for (let d = 1; d <= 31; d++) {
    if (d % 7 === 4) continue; // closed one day a week
    rows.push({ day: d, narr: `DEPOSIT PAYGRID SETTLEMENT REF ${digits(8)}`, in: cents(1450, 3120), truth: 'SAL' });
  }
  rows.push({ day: 9, narr: 'MOBILE CHECK DEPOSIT', in: 860, truth: 'SAL' }); // catering cheque
  rows.push({ day: 23, narr: 'MOBILE CHECK DEPOSIT', in: 1240, truth: 'SAL' });
  // Suppliers.
  rows.push({ day: 2, narr: 'ACH DEBIT RIDGELINE COFFEE ROASTERS INV 7781', out: 2460, truth: 'PUR' });
  rows.push({ day: 16, narr: 'ACH DEBIT RIDGELINE COFFEE ROASTERS INV 7832', out: 2295, truth: 'PUR' });
  rows.push({ day: 7, narr: 'ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231', out: 1845, truth: 'PUR' });
  rows.push({ day: 8, narr: 'ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2231', out: 1845, truth: 'PUR' }); // planted duplicate
  rows.push({ day: 21, narr: 'ACH DEBIT HARBORVIEW BAKERY SUPPLY INV 2290', out: 1520, truth: 'PUR' });
  for (const d of [4, 11, 18, 25]) rows.push({ day: d, narr: `ACH DEBIT GREENFIELD DAIRY CO INV ${5500 + d} WEEKLY MILK`, out: cents(560, 640), truth: 'PUR' });
  rows.push({ day: 28, narr: 'ACH DEBIT GREENFIELD DAIRY CO INV 5528 HOLIDAY ORDER', out: 3150, truth: 'PUR' }); // planted spike
  rows.push({ day: 10, narr: 'CARD PURCHASE 10/10 BAYSIDE CASH AND CARRY #221', out: 735.4, truth: 'PUR' });
  rows.push({ day: 22, narr: 'CHECK 1204 HARBOR LINEN SERVICE', out: 410, truth: 'SUP', ref: '1204' });
  // Fixed costs.
  rows.push({ day: 1, narr: 'ACH DEBIT OAKMONT PROPERTIES RENT UNIT 3', out: 4800, truth: 'RNT' });
  rows.push({ day: 9, narr: 'ACH DEBIT CITY POWER CO UTIL PMT', out: 612.18, truth: 'UTL' });
  rows.push({ day: 14, narr: 'ACH DEBIT FIBERLINK INTERNET AUTOPAY', out: 89.99, truth: 'UTL' });
  rows.push({ day: 3, narr: 'ACH DEBIT TRUSTLINE CAPITAL LOAN PMT 14 OF 60', out: 1285, truth: 'EMI' });
  rows.push({ day: 20, narr: 'ACH DEBIT HOMESAFE INSURANCE PREMIUM', out: 214, truth: 'INS' });
  rows.push({ day: 20, narr: 'ACH DEBIT STATE DEPT OF REVENUE SALES TAX SEP', out: 864.2, truth: 'TAX' });
  rows.push({ day: 15, narr: 'ACH DEBIT PAYDAY PAYROLL SVC NET PAY', out: 6120, truth: 'WAG' });
  rows.push({ day: 30, narr: 'ACH DEBIT PAYDAY PAYROLL SVC NET PAY', out: 6185, truth: 'WAG' });
  rows.push({ day: 12, narr: 'INSTANT PAY TO NOVAK BOOKKEEPING MEMO SEPT BOOKS', out: 250, truth: 'FEE' });
  rows.push({ day: 15, narr: 'CARD PURCHASE 10/15 TABLETAB POS SOFTWARE MONTHLY', out: 69, truth: 'SUB' });
  rows.push({ day: 17, narr: 'CARD PURCHASE 10/17 METRO CAB CO', out: 41.5, truth: 'TRV' });
  rows.push({ day: 26, narr: 'CARD PURCHASE 10/26 OFFICE CORNER #118', out: 54.2, truth: 'SUP' });
  rows.push({ day: 29, narr: 'CARD PURCHASE 10/29 BRIGHTCLEAN SUPPLY', out: 82, truth: 'SUP' });
  rows.push({ day: 31, narr: 'MONTHLY SERVICE FEE', out: 15, truth: 'CHG' });
  rows.push({ day: 31, narr: 'CREDIT INTEREST', in: 2.14, truth: 'INT' });
  rows.push({ day: 6, narr: 'ONLINE TRANSFER TO SAV XXXX4410', out: 2000, truth: 'OWN' });
  // Planted: money out to a person comes back from a company sharing his surname.
  rows.push({ day: 12, narr: 'INSTANT PAY TO DANIEL REYES MEMO ADVANCE', out: 7500, truth: 'ADV' });
  rows.push({ day: 15, narr: 'WIRE IN FROM REYES CONSTRUCTION LLC MEMO RETURN', in: 7500, truth: 'ADV' });
  // Planted: cash deposits just under the $10,000 reporting threshold.
  for (const [d, a] of [[16, 9800], [18, 9500], [21, 9900]]) rows.push({ day: d, narr: 'CASH DEPOSIT BRANCH 112', in: a, truth: 'CSH' });
  // Planted: the owner's personal spending through the business account.
  rows.push({ day: 8, narr: 'CARD PURCHASE 10/08 BRIGHTWOOD ACADEMY TUITION', out: 2800, truth: 'DRW' });
  rows.push({ day: 25, narr: 'CARD PURCHASE 10/25 AURORA DAY SPA', out: 240, truth: 'DRW' });
  rows.push({ day: 26, narr: 'CARD PURCHASE 10/26 LUMEN JEWELERS', out: 680, truth: 'DRW' });
  // Planted: a free-text name and phone number the structured parser cannot see.
  rows.push({ day: 23, narr: 'INSTANT PAY TO MIKE TORRES MEMO for jenny piano lessons call 415-555-0143', out: 300, truth: 'DRW' });
  return finish(rows, 2026, 10, 'cafe', {
    preamble: [['Hollis & Pine Coffee LLC - Business Checking'], ['Account ending 2286'], ['Statement period 10/01/2026 - 10/31/2026'], ['Amounts in USD'], []],
    header: ['Date', 'Description', 'Withdrawals', 'Deposits', 'Balance'],
    opening: 18240.55,
    row: (date, r, bal) => [date, r.narr, r.out ? r.out.toFixed(2) : '', r.in ? r.in.toFixed(2) : '', bal.toFixed(2)],
    dateFmt: (y, m, d) => `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`,
  });
}

// ---------------------------------------------------------------- 2. Homeowners' association (US)
function hoa() {
  const { between, cents } = tools(20260701);
  const rows = [];
  const owners = ['SARAH KIM', 'JAMES OKORO', 'PRIYA RAMAN', 'TOMAS LINDQVIST', 'ANGELA BRUNO', 'DEREK MILLS', 'FATIMA HASSAN', 'NOAH BERG', 'GRACE CHEN', 'OMAR FARID', 'LUCY HARPER', 'ETHAN COLE', 'MAYA SINGH', 'CARLOS VEGA'];
  owners.forEach((o, i) => rows.push({ day: 1 + (i % 12), month: 7, narr: `INSTANT PAY FROM ${o} MEMO LOT ${10 + i} Q3 DUES`, in: 450, truth: 'DUE' }));
  owners.slice(0, 4).forEach((o, i) => rows.push({ day: 14 + i * 3, month: 8, narr: `INSTANT PAY FROM ${o} MEMO SUMMER PICNIC`, in: between(25, 60), truth: 'DUE' }));
  rows.push({ day: 6, month: 7, narr: 'MOBILE CHECK DEPOSIT', in: 1350, truth: 'DUE' });
  for (const m of [7, 8, 9]) {
    rows.push({ day: 3, month: m, narr: 'ACH DEBIT SENTRY GATE SECURITY MONTHLY', out: 1800, truth: 'PUR' });
    rows.push({ day: 9, month: m, narr: 'ACH DEBIT CITY POWER CO COMMON AREA', out: cents(310, 395), truth: 'UTL' });
    rows.push({ day: 15, month: m, narr: `CHECK ${2040 + m} EVERGREEN LANDSCAPING`, out: 950, truth: 'SUP', ref: String(2040 + m) });
    rows.push({ day: 21, month: m, narr: 'ACH DEBIT AQUACLEAR POOL SERVICE INV ' + (3300 + m), out: 420, truth: 'SUP' });
  }
  rows.push({ day: 22, month: 7, narr: 'ACH DEBIT AQUACLEAR POOL SERVICE INV 3307', out: 420, truth: 'SUP' }); // planted duplicate (same invoice)
  // Planted: roof repair split into three checks under the $2,500 board-approval limit.
  for (const [d, a, c] of [[11, 2400, 2061], [13, 2350, 2062], [15, 2450, 2063]]) rows.push({ day: d, month: 8, narr: `CHECK ${c} SUMMIT ROOFING`, out: a, truth: 'SUP', ref: String(c) });
  rows.push({ day: 18, month: 7, narr: 'INSTANT PAY TO LINDA HUANG MEMO REIMB POOL CHEMICALS', out: 186.4, truth: 'SUP' });
  rows.push({ day: 22, month: 8, narr: 'INSTANT PAY TO LINDA HUANG MEMO REIMB PICNIC SUPPLIES', out: 312.75, truth: 'SUP' });
  // Planted: a "loan" to a board member that comes back (round trip).
  rows.push({ day: 2, month: 9, narr: 'INSTANT PAY TO KEVIN PARK MEMO EVENT ADVANCE', out: 3000, truth: 'ADV' });
  rows.push({ day: 8, month: 9, narr: 'INSTANT PAY FROM KEVIN PARK MEMO RETURNED', in: 3000, truth: 'ADV' });
  // Planted: pool-pass cash deposited in pieces just under $10,000.
  for (const [d, a] of [[24, 9600], [26, 9400]]) rows.push({ day: d, month: 9, narr: 'CASH DEPOSIT BRANCH 044 POOL PASS FEES', in: a, truth: 'CSH' });
  rows.push({ day: 12, month: 9, narr: 'INSTANT PAY TO BRIGHTLINE CPA GROUP MEMO ANNUAL REVIEW', out: 1500, truth: 'FEE' });
  rows.push({ day: 10, month: 8, narr: 'ACH DEBIT HOMESAFE INSURANCE PREMIUM', out: 1120, truth: 'INS' });
  rows.push({ day: 30, month: 9, narr: 'CREDIT INTEREST', in: 18.4, truth: 'INT' });
  rows.push({ day: 30, month: 9, narr: 'CHECK ORDER FEE', out: 32, truth: 'CHG' });
  return finish(rows, 2026, 7, 'hoa', {
    preamble: [['Willow Creek Homeowners Association - Operating Account'], ['Account ending 0377'], ['Statement period 07/01/2026 - 09/30/2026'], ['Amounts in USD'], []],
    header: ['Posting Date', 'Description', 'Debit', 'Credit', 'Balance', 'Check Number'],
    opening: 41230,
    row: (date, r, bal) => [date, r.narr, r.out ? r.out.toFixed(2) : '', r.in ? r.in.toFixed(2) : '', bal.toFixed(2), r.ref ?? ''],
    dateFmt: (y, m, d) => `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`,
  });
}

// ---------------------------------------------------------------- 3. Animal-rescue nonprofit (US)
function rescue() {
  const { between } = tools(20260702);
  const rows = [];
  const donors = ['JANE MORALES', 'ROBERT CHEN', 'AISHA BELL', 'TOM WALSH', 'LINDA OKAFOR', 'GREG PATEL', 'MARIA LOPEZ', 'SAM KOWALSKI'];
  donors.forEach((d, i) => rows.push({ day: 2 + i * 3, month: 7 + (i % 3), narr: `INSTANT PAY FROM ${d} MEMO DONATION`, in: [50, 120, 75, 250, 40, 500, 60, 150][i], truth: 'DUE' }));
  rows.push({ day: 15, month: 7, narr: 'WIRE IN FROM HILLSIDE COMMUNITY FOUNDATION MEMO Q3 GRANT', in: 18000, truth: 'DUE' });
  for (const m of [7, 8, 9]) {
    rows.push({ day: 1, month: m, narr: 'ACH DEBIT RIVERSIDE PROPERTIES RENT KENNEL BLDG', out: 2200, truth: 'RNT' });
    rows.push({ day: 12, month: m, narr: 'ACH DEBIT CITY POWER CO UTIL PMT', out: between(310, 420), truth: 'UTL' });
    rows.push({ day: 6, month: m, narr: `CARD PURCHASE 0${m}/06 PETSUPPLY DEPOT #221`, out: between(640, 980) + 0.5, truth: 'PUR' });
    rows.push({ day: 28, month: m, narr: 'ACH DEBIT PAYDAY PAYROLL SVC NET PAY', out: 6400, truth: 'WAG' });
  }
  rows.push({ day: 19, month: 8, narr: 'CARD PURCHASE 08/19 PETSUPPLY DEPOT #221', out: 1284.5, truth: 'PUR' });
  rows.push({ day: 19, month: 8, narr: 'CARD PURCHASE 08/19 PETSUPPLY DEPOT #221', out: 1284.5, truth: 'PUR' }); // planted duplicate
  for (const [d, a, c] of [[3, 2400, 1041], [5, 2350, 1042], [8, 2450, 1043]]) rows.push({ day: d, month: 9, narr: `CHECK ${c} OAKWOOD VETERINARY CLINIC`, out: a, truth: 'PUR', ref: String(c) }); // planted split
  rows.push({ day: 10, month: 7, narr: 'ACH DEBIT HOMESAFE INSURANCE PREMIUM', out: 940, truth: 'INS' });
  rows.push({ day: 14, month: 8, narr: 'INSTANT PAY TO MARK DELANEY MEMO TRANSPORT ADVANCE', out: 5000, truth: 'ADV' });
  rows.push({ day: 20, month: 8, narr: 'INSTANT PAY FROM MARK DELANEY MEMO RETURN', in: 5000, truth: 'ADV' }); // planted round trip
  for (const [d, a] of [[22, 9500], [25, 9800]]) rows.push({ day: d, month: 9, narr: 'CASH DEPOSIT BRANCH 044 ADOPTION EVENT', in: a, truth: 'CSH' }); // planted structuring
  rows.push({ day: 16, month: 9, narr: 'CARD PURCHASE 09/16 AURORA DAY SPA', out: 320, truth: 'DRW' });
  rows.push({ day: 30, month: 9, narr: 'MONTHLY SERVICE FEE', out: 15, truth: 'CHG' });
  rows.push({ day: 30, month: 9, narr: 'CREDIT INTEREST', in: 3.12, truth: 'INT' });
  return finish(rows, 2026, 7, 'rescue', {
    preamble: [['Maple Street Animal Rescue - Operating Account'], ['Account ending 9917'], ['Statement period 07/01/2026 - 09/30/2026'], ['Amounts in USD'], []],
    header: ['Date', 'Description', 'Amount', 'Running Bal.'],
    opening: 23810.44,
    row: (date, r, bal) => [date, r.narr, (r.out ? -r.out : r.in).toFixed(2), bal.toFixed(2)],
    dateFmt: (y, m, d) => `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`,
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
    csv.push(f.row(f.dateFmt(year, r.month, r.day), r, bal));
    truth.push(r.truth);
  }
  const text = csv.map(row => row.map(c => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
  writeFileSync(`${OUT}/${name}.csv`, text);
  writeFileSync(`${OUT}/${name}.truth.json`, JSON.stringify(truth));
  console.log(`${name}: ${rows.length} rows`);
}

cafe();
hoa();
rescue();
