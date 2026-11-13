# Export layouts

Made-up statements written in the layouts that real banks export, used by the import tests
(`src/engine/formats.test.ts`). Every person, business and number in them is invented.

| File | Layout |
|---|---|
| `us-signed-amount.csv` | One signed amount column, a "Type" column that does not say debit or credit, a "Details" column next to "Description" |
| `us-summary-on-top.csv` | A summary block above the table, month-first dates, amounts in quotes |
| `us-no-header.csv` | No header row at all |
| `uk-debit-credit.csv` | Separate debit and credit columns, day-first dates, sort code and account number columns |
| `in-withdrawal-deposit.csv` | Withdrawal and deposit columns with the currency in the header, UPI and NEFT narrations |
| `long-dates.csv` | Dates written out, dates with a time, a negative amount in brackets |
| `eu-semicolon.csv` | Semicolons between columns, decimal comma |
