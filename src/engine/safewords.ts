// Default-deny vocabulary for free-text payment notes. A word in a note is only sent (masked
// text, cloud review) if it is on this list of everyday purpose words, or is a short number or
// a date fragment. Everything else (a child's first name, a street, a nickname) becomes a
// placeholder on the device. Words that are also common first names (bill, mark, grace, rose,
// jack, frank, will, hope...) are deliberately left out.

const WORDS = `
a an the and or of for to from in on at by with without per via as is was are be been not no yes our your my his her their its this that these those it we you they he she me us them all any some each every other more less new old first second third last next final part full half extra misc etc same back again also only just plus
jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december
mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday day days week weeks weekly month months monthly year years yearly annual annually quarter quarterly daily today tonight morning evening night term terms semester season seasonal holiday holidays summer winter spring fall autumn festival fy ytd eom
payment payments pay paid pmt pmts payroll salary salaries wage wages bonus bonuses commission advance advances advanced loan loans emi repay repaid repayment return returned returns refund refunded reversal reverse reimb reimbursement reimbursements reimburse deposit deposits withdrawal withdrawals transfer transfers settlement settlements settle invoice invoices inv bills billing receipt receipts order orders purchase purchases sale sales credit credits debit debits balance balances due dues fee fees charge charges interest tax taxes gst vat tds tuition rent rental rentals lease security premium premiums insurance policy claim claims grant grants donation donations contribution contributions subscription subscriptions plan plans renewal membership member members fund funds capital investment savings statement adjustment adjustments discount cashback rebate penalty late overdue outstanding pending partial installment installments instalment instalments booking books bookkeeping accounting audit filing deposit cash cheque check checks mobile online card pos atm branch counter self own family personal private business company office home house apartment flat unit lot plot building bldg common area main ref no amt amount total net gross
stock supplies supply goods material materials inventory ingredients milk dairy bread bakery cake cakes coffee tea food foods lunch dinner breakfast meal meals snacks groceries grocery ration rations vegetables vegetable fruit fruits oil flour sugar rice beans meat fish eggs spices sweets juice water ice packaging packing bags bag boxes box cartons cleaning cleaner chemicals chemical pool garden gardening landscaping lawn trees roof roofing repair repairs maintenance service servicing painting paint plumbing plumber electrical electrician wiring lift elevator guard guards gate parking electricity power gas fuel petrol diesel internet phone wifi broadband utility utilities software app apps laptop computer printer paper stationery shop store kitchen equipment tools tool furniture uniform uniforms linen laundry delivery shipping courier postage transport travel taxi cab cabs train trains flight flights hotel toll tolls event events party picnic wedding birthday anniversary gift gifts celebration decor decoration decorations flowers music lessons lesson class classes course courses training school college university books book piano guitar dance sports gym fitness swimming medical medicine medicines doctor hospital clinic dental vet veterinary pet pets animal animals kennel adoption rescue shelter consulting consultant consultancy design legal lawyer cpa accountant review marketing ads advertising printing website hosting domain spa salon jewellery jewelry clothes clothing shopping movie movies cinema tickets ticket trip trips tour vacation
sent received collected owed owe lent borrowed bought sold ordered booked hired renewed cancelled canceled split shared top up call contact entry adj prepaid postpaid recharge new used weekly
`;

export const SAFE_WORDS = new Set(WORDS.split(/\s+/).filter(Boolean).map(w => w.toLowerCase()));

/** Short numbers, quarters, dates and invoice-style codes carry no identity on their own. */
export function isSafeToken(word: string): boolean {
  const w = word.toLowerCase();
  if (SAFE_WORDS.has(w)) return true;
  if (/^\d{1,6}$/.test(w)) return true; // invoice or lot numbers, amounts
  if (/^q[1-4]$/.test(w) || /^\d{1,2}(st|nd|rd|th)$/.test(w)) return true;
  if (/^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(w)) return true; // dates
  if (/^[a-z]{1,4}\d{1,6}$/.test(w) && !/^\d{7,}$/.test(w)) return true; // INV2231, A12
  return false;
}
