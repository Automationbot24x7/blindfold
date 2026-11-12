// Internal speed lab (not part of the product UI): times on-device categorisation via Firebase AI Logic.
import { deviceModel } from '../lib/firebase';

const CATEGORIES = [
  'SALES_RECEIPT', 'SALARY_WAGES', 'RENT', 'UTILITIES', 'FOOD_MEALS', 'GROCERIES_SUPPLIES', 'TRAVEL_FUEL',
  'LOAN_EMI', 'INSURANCE', 'TAXES', 'BANK_CHARGES', 'INTEREST', 'CASH_WITHDRAWAL', 'OWN_TRANSFER',
  'PROFESSIONAL_FEES', 'SOFTWARE_SUBSCRIPTIONS', 'SUPPLIER_PURCHASE', 'REFUND', 'PERSONAL_TRANSFER', 'UNSURE',
] as const;

const SAMPLE = [
  'UPI/DR/412345678901/FOODLOOP/AXRB/foodloop.pay@axr/Payment',
  'UPI/CR/431298765432/RAMESH KUMAR/PNXB/ramesh.k@okpnx/rent nov',
  'NEFT/N123456789012/ACME SOFTWARE PVT LTD/NOVA0001234/SALARY OCT',
  'IMPS/P2A/412398765432/SURESH TRADERS/ZENB/Invoice 4471',
  'ATM WDL/ATM ID S1BW000123/MUMBAI ANDHERI',
  'POS 4123XXXXXXXX1234 METROMART SUPERMARKET',
  'ACH D- TP ACH SWIFTFIN LOANS-123456789',
  'NACH/LIFESURE INSURANCE/PREMIUM',
  'BIL/BPAY/000123456/SKYLINK BROADBAND',
  'CHQ DEP/CLG/000045/CITY COOP BANK',
  'INT.PD 01-10-2026 TO 31-10-2026',
  'GST PAYMENT/CHALLAN 2610012345',
  'UPI/DR/412300011122/CLOUDDESK SUBSCRIPTION/AXRB/clouddesk@axr/Monthly plan',
  'UPI/CR/431200099988/PRIYA SHARMA/ZENB/priya.s@okzen/Invoice 118 design work',
  'NEFT/N998877665544/SELF/NOVA0004321/Transfer to savings',
  'UPI/DR/412355566677/CITYRIDE CABS/PNXB/cityride@pnx/Trip',
  'UPI/DR/412366677788/HP FUEL STATION 22/AXRB/fuel22@axr/Fuel',
  'CHARGES/SMS ALERT CHG Q3',
  'UPI/CR/431211122233/QUICKCART MARKETPLACE/NOVA/qcart.settle@nova/Settlement 0926',
  'IMPS/P2A/412377788899/MAHESH ELECTRICALS/PNXB/Advance for wiring',
  'UPI/DR/412388899900/ANITA DESAI/AXRB/anita.d@okaxr/Consulting fee Oct',
  'TDS PAYMENT/CHALLAN 281/Q2',
  'UPI/DR/412399900011/STATE POWER BOARD/ZENB/powerbill@zen/Electricity',
  'REV/UPI/412345678901/FOODLOOP/Refund',
  'UPI/DR/412311122233/VIKRAM SINGH/PNXB/vikram.s@okpnx/Lunch split',
  'NEFT/N556677889900/OFFICE SPACES LLP/NOVA0005555/Rent Nov',
  'UPI/DR/412322233344/STATIONERY WORLD/AXRB/stationery@axr/Printer paper',
  'UPI/CR/431233344455/BRIGHTPATH CONSULTING/ZENB/brightpath@zen/Retainer Nov',
  'ATM WDL/ATM ID P2NX000777/PUNE FC ROAD',
  'UPI/DR/412344455566/KAVYA FOODS/PNXB/kavya.f@pnx/Team dinner',
];

const out = document.createElement('pre');
const status = document.createElement('div');
const root = document.getElementById('root')!;
const log = (s: string) => { out.textContent += s + '\n'; };

const schema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          category: { type: 'string', enum: [...CATEGORIES] },
          counterparty: { type: 'string' },
          counterpartyKind: { type: 'string', enum: ['PERSON', 'BUSINESS', 'SELF', 'GOVERNMENT', 'BANK', 'NONE'] },
        },
        required: ['i', 'category', 'counterparty', 'counterpartyKind'],
      },
    },
  },
  required: ['items'],
};

const model = deviceModel({ responseConstraint: schema });

async function checkStatus() {
  const lm = (globalThis as unknown as { LanguageModel?: { availability: (o?: object) => Promise<string> } }).LanguageModel;
  status.textContent = lm
    ? `LanguageModel.availability(): ${await lm.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })}`
    : 'LanguageModel API not present in this browser';
}

function button(label: string, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onClick;
  root.append(b);
  return b;
}

button('Check status', () => void checkStatus());
button('Prepare on-device model', () => {
  log('initializeDeviceModel() called');
  model
    .initializeDeviceModel(p => { status.textContent = `Downloading on-device model: ${(p * 100).toFixed(1)}%`; })
    .then(() => { log('initializeDeviceModel resolved'); void checkStatus(); })
    .catch(e => log('initializeDeviceModel error: ' + (e as Error).message));
});
button('Run benchmark (30 narrations)', async () => {
  for (const size of [10, 15]) {
    for (let start = 0; start < SAMPLE.length; start += size) {
      const batch = SAMPLE.slice(start, start + size);
      const prompt =
        'Categorise each bank-statement narration from an Indian small business account. ' +
        'For each line return its index i, the best ledger category, the counterparty name as written (or "" if none), ' +
        'and the counterparty kind. Use UNSURE when you cannot tell.\n\n' +
        batch.map((n, k) => `${k}. ${n}`).join('\n');
      const t0 = performance.now();
      try {
        const r = await model.generateContent(prompt);
        const ms = performance.now() - t0;
        const text = r.response.text();
        const parsed = JSON.parse(text) as { items: { i: number; category: string; counterparty: string; counterpartyKind: string }[] };
        log(`batch size ${size} @${start}: ${ms.toFixed(0)} ms, source=${r.response.inferenceSource}, items=${parsed.items.length}`);
        for (const it of parsed.items) log(`   ${it.i}. ${it.category.padEnd(22)} ${it.counterpartyKind.padEnd(10)} ${it.counterparty}  <=  ${batch[it.i] ?? '?'}`);
      } catch (e) {
        log(`batch size ${size} @${start}: ERROR ${(e as Error).message}`);
      }
    }
  }
  log('done');
});

// Compact format: one short code per line, nothing else. Counterparty names are parsed by code, not by the model.
const CODES: Record<string, string> = {
  SAL: 'sales or customer receipt', WAG: 'salary or wages', RNT: 'rent', UTL: 'utilities: power, water, phone, internet',
  FOD: 'food and meals', SUP: 'groceries, stationery, supplies', TRV: 'travel, cabs, fuel', EMI: 'loan EMI',
  INS: 'insurance premium', TAX: 'tax payment (GST, TDS)', CHG: 'bank charges', INT: 'interest',
  ATM: 'cash withdrawal', OWN: 'transfer between own accounts', FEE: 'professional or consulting fees',
  SUB: 'software subscription', PUR: 'supplier or vendor purchase', REF: 'refund or reversal',
  P2P: 'personal transfer to or from an individual', UNS: 'unsure',
};
const compactModel = deviceModel({
  responseConstraint: { type: 'object', properties: { c: { type: 'array', items: { type: 'string', enum: Object.keys(CODES) } } }, required: ['c'] },
});
button('Run compact benchmark', async () => {
  const legend = Object.entries(CODES).map(([k, v]) => `${k} = ${v}`).join('\n');
  for (const size of [10, 15, 30]) {
    for (let start = 0; start < SAMPLE.length; start += size) {
      const batch = SAMPLE.slice(start, start + size);
      const prompt =
        `Codes:\n${legend}\n\nGive one code per bank-statement line, in order (${batch.length} codes). ` +
        'DR = money out, CR = money in.\n\n' + batch.map((n, k) => `${k + 1}. ${n}`).join('\n');
      const t0 = performance.now();
      try {
        const r = await compactModel.generateContent(prompt);
        const ms = performance.now() - t0;
        const codes = (JSON.parse(r.response.text()) as { c: string[] }).c;
        log(`compact size ${size} @${start}: ${ms.toFixed(0)} ms, source=${r.response.inferenceSource}, codes=${codes.length}`);
        codes.forEach((c, k) => log(`   ${c}  <=  ${batch[k] ?? '?'}`));
      } catch (e) {
        log(`compact size ${size} @${start}: ERROR ${(e as Error).message}`);
      }
    }
  }
  log('compact done');
});

button('Test cloud call', async () => {
  const { cloudModel } = await import('../lib/firebase');
  for (const name of ['gemini-3.5-flash-lite', 'gemini-3.8-flash']) {
    const m = cloudModel({ model: name });
    const t0 = performance.now();
    try {
      const r = await m.generateContent('Reply with the single word: ready');
      log(`cloud ${name}: ${(performance.now() - t0).toFixed(0)} ms, source=${r.response.inferenceSource}, text=${r.response.text().trim()}`);
    } catch (e) {
      log(`cloud ${name} ERROR ` + (e as Error).message.slice(0, 160));
    }
  }
});

root.append(status, out);
void checkStatus();
