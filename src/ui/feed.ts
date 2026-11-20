// Statement lines from the café sample used on the landing page. Placeholders match the recorded run.
export interface Seg { raw: string; masked?: string }
// head: the category the on-device model gave the row, exactly as the cloud receives it ("category: ...").
// sent: false for rows the computer labelled alone; they never left it.
// link: rows that code on the computer tied together (same surname); the hero draws a thread between their codes.
export interface FeedRow { date: string; dir: 'OUT' | 'IN'; amount: string; segs: Seg[]; head: string; flag?: string; sent?: boolean; link?: string }

export const FEED: FeedRow[] = [
  { date: '02 Oct', dir: 'OUT', amount: '$2,460.00', sent: false, head: 'Purchases & suppliers', segs: [{ raw: 'ACH debit ' }, { raw: 'RIDGELINE COFFEE ROASTERS', masked: '[BUSINESS_3]' }, { raw: ' · INV 7781' }] },
  { date: '07 Oct', dir: 'OUT', amount: '$1,845.00', head: 'Purchases & suppliers', segs: [{ raw: 'ACH debit ' }, { raw: 'HARBORVIEW BAKERY SUPPLY', masked: '[BUSINESS_6]' }, { raw: ' · INV 2231' }] },
  { date: '08 Oct', dir: 'OUT', amount: '$1,845.00', head: 'Purchases & suppliers', flag: 'Paid twice', segs: [{ raw: 'ACH debit ' }, { raw: 'HARBORVIEW BAKERY SUPPLY', masked: '[BUSINESS_6]' }, { raw: ' · INV 2231' }] },
  { date: '08 Oct', dir: 'OUT', amount: '$2,800.00', head: 'Personal spending', flag: 'Personal?', segs: [{ raw: 'Card purchase ' }, { raw: 'BRIGHTWOOD ACADEMY TUITION', masked: '[BUSINESS_7]' }] },
  { date: '12 Oct', dir: 'OUT', amount: '$7,500.00', head: 'Advances & loans to others', link: 'rt', flag: 'Out and back', segs: [{ raw: 'Instant pay to ' }, { raw: 'DANIEL REYES', masked: '[PERSON_1]' }, { raw: ' · memo ADVANCE' }] },
  { date: '15 Oct', dir: 'IN', amount: '$7,500.00', head: 'Advances & loans to others', link: 'rt', flag: 'Same surname', segs: [{ raw: 'Wire in from ' }, { raw: 'REYES CONSTRUCTION LLC', masked: '[BUSINESS_12]' }, { raw: ' · memo RETURN' }] },
  { date: '16 Oct', dir: 'IN', amount: '$9,800.00', head: 'Cash deposit', flag: 'Just under $10k', segs: [{ raw: 'Cash deposit · branch 112' }] },
  { date: '23 Oct', dir: 'OUT', amount: '$300.00', head: 'Personal spending', flag: 'Personal?', segs: [{ raw: 'Instant pay to ' }, { raw: 'MIKE TORRES', masked: '[PERSON_2]' }, { raw: ' · for ' }, { raw: 'jenny', masked: '[WORD_1]' }, { raw: ' piano lessons, call ' }, { raw: '415-555-0143', masked: '[PHONE_1]' }] },
  { date: '28 Oct', dir: 'OUT', amount: '$3,150.00', head: 'Purchases & suppliers', flag: '5× usual', segs: [{ raw: 'ACH debit ' }, { raw: 'GREENFIELD DAIRY CO', masked: '[BUSINESS_5]' }, { raw: ' · INV 5528 holiday order' }] },
];
