// Ledger heads. Short codes keep on-device answers small (and fast); labels are for people.
import type { Direction } from './types';

export interface Category {
  code: string;
  label: string;
  hint: string; // shown to the model
  dirs: Direction[];
}

export const CATEGORIES: Category[] = [
  { code: 'SAL', label: 'Sales & customer receipts', hint: 'money received from customers or clients for goods or services', dirs: ['in'] },
  { code: 'CSH', label: 'Cash deposit', hint: 'notes and coins paid in at a branch or ATM (not cheques)', dirs: ['in'] },
  { code: 'LOA', label: 'Loan or capital received', hint: 'loan disbursal or owner putting money in', dirs: ['in'] },
  { code: 'INT', label: 'Interest received', hint: 'bank interest credited', dirs: ['in'] },
  { code: 'RFD', label: 'Refund or reversal', hint: 'a supplier or bank giving back money for an earlier purchase or charge', dirs: ['in'] },
  { code: 'ADV', label: 'Advances & loans to others', hint: 'money lent or advanced to a person or company, or that money being paid back', dirs: ['in', 'out'] },
  { code: 'DUE', label: 'Dues, donations & grants', hint: 'membership or association dues, donations, grants', dirs: ['in'] },
  { code: 'PUR', label: 'Purchases & suppliers', hint: 'payment to a supplier, wholesaler, cash-and-carry or vendor for stock, ingredients or services', dirs: ['out'] },
  { code: 'RNT', label: 'Rent', hint: 'rent for shop, office or premises', dirs: ['out'] },
  { code: 'UTL', label: 'Utilities & telecom', hint: 'electricity, water, gas, phone, internet', dirs: ['out'] },
  { code: 'WAG', label: 'Salaries & wages', hint: 'payroll, pay to staff', dirs: ['out'] },
  { code: 'TAX', label: 'Taxes', hint: 'sales tax, VAT, GST, payroll or income tax, other government dues', dirs: ['out'] },
  { code: 'EMI', label: 'Loan repayment', hint: 'loan payment or instalment to a lender', dirs: ['out'] },
  { code: 'INS', label: 'Insurance', hint: 'insurance premium', dirs: ['out'] },
  { code: 'CHG', label: 'Bank charges', hint: 'fees charged by the bank', dirs: ['out'] },
  { code: 'FEE', label: 'Professional fees', hint: 'accountant, lawyer, consultant or other professional', dirs: ['out'] },
  { code: 'SUB', label: 'Software & subscriptions', hint: 'software, apps, online subscriptions', dirs: ['out'] },
  { code: 'TRV', label: 'Travel & fuel', hint: 'cabs, trains, flights, fuel', dirs: ['out'] },
  { code: 'FOD', label: 'Meals & entertainment', hint: 'restaurants, food delivery, cinema', dirs: ['out'] },
  { code: 'SUP', label: 'Supplies & maintenance', hint: 'stationery, cleaning, repairs, small items', dirs: ['out'] },
  { code: 'ATM', label: 'Cash withdrawal', hint: 'cash taken out at an ATM or counter', dirs: ['out'] },
  { code: 'DRW', label: 'Personal spending', hint: 'school fees, family, spa, jewellery, personal shopping paid from the organisation account', dirs: ['out'] },
  { code: 'OWN', label: 'Own-account transfer', hint: 'moving money between the same owner’s accounts', dirs: ['in', 'out'] },
  { code: 'P2P', label: 'Transfer with an individual', hint: 'money sent to or received from a private person with no business purpose stated', dirs: ['in', 'out'] },
  { code: 'OTH', label: 'Other', hint: 'clear purpose that fits no other head', dirs: ['in', 'out'] },
  { code: 'UNS', label: 'Unsure', hint: 'cannot tell from the text', dirs: ['in', 'out'] },
];

export const BY_CODE = new Map(CATEGORIES.map(c => [c.code, c]));

export function codesFor(dir: Direction): string[] {
  return CATEGORIES.filter(c => c.dirs.includes(dir)).map(c => c.code);
}

export function label(code?: string): string {
  return (code && BY_CODE.get(code)?.label) || 'Uncategorised';
}
