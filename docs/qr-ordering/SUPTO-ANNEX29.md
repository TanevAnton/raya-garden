# Registering the QR system as "СУПТО": the gap against Annex 29

Status, 29.10.2026: **the answer is yes.** The accountant (after talking to
Сашо): two "СУПТО" can work in the restaurant **if each has its own fiscal
printer**. Clock keeps the till and its printer; ours drives a separate
printer for payments made on the phone. One condition: our system also
**passes its sales to Clock**, so the restaurant's turnover is in one place
and the two don't disagree. In practice that's Clock's end-of-day transfer of
bills already paid and fiscalised (their "POS Guide, EOD"), done the way НАП's
control sheet (section 3.2) and Annex 41 describe. This document is now the
work plan.

The source texts are in `nap/`: Annex 29 (`prilozhenie-29.txt`), Annex 31
(`prilozhenie-31.txt`), and НАП's self-assessment control sheet for СУПТО
producers (`kontrolen-list-supto.txt`).

## Why this comes up

- **Bills paid on the spot need a fiscal receipt at the moment of payment**
  (Сашо, 22.10.2026). Clock won't print receipts for money taken through our
  Stripe (19.10.2026).
- **In a site that uses a "СУПТО", every fiscal device must be driven by a
  registered "СУПТО"** (Наредба Н-18, чл. 52з, ал. 3). So the separate
  printer built in `_lib/fiscal.php` and `tools/fiscal-bridge/` can't be used
  while our program is unregistered. It's live but off (`QR_FISCAL_MODE`
  unset), and no printer has been bought.
- **More than one "СУПТО" in a site is allowed, as we read it:**
  - Annex 29, т. 9: "Когато в търговски обект към едно фискално устройство
    са свързани два или повече софтуера за управление на продажбите" — each
    gets its own range of sale-number sequences;
  - чл. 52з, ал. 9, and control sheet section 3.1: a person "работи с повече
    от един СУПТО".

  So registering ours shouldn't force dropping Clock. That's the reading to
  be confirmed.

## The 23 requirements, against the system as it is

✓ already met · ◐ partly · ✗ to build · — doesn't apply

| # | Requirement (short) | Now | What it takes |
| --- | --- | --- | --- |
| 1 | Interface in Bulgarian | ✓ | Staff screen and menu are Bulgarian (menu also English). |
| 2 | Completeness and integrity of data | ◐ | SQLite in transactions; `audit_log` (schema v14), append-only by triggers. To add: a periodic integrity check, and a written description. |
| 3 | No duplicate sales functionality in other modules | ✓ | One module sells. Describe it. |
| 4 | Built-in protection against unauthorised changes or modules | ✗ | Checksums of the deployed code, checked at start-up and shown to the auditor; a version manifest; deploys only from the declared tag. |
| 5 | Exact time; sync with the fiscal printer at start and at least daily | ✓ | Done 29.10 (phase 2): the bridge sets the printer's clock (ErpNet.FP datetime) at start, daily and when over 30 s off; reports the drift; phone payments stop past 5 minutes; „За касата“ warns when the bridge computer's clock differs from the server's. |
| 6 | Operators: unique code, at least two names, role/rights, active period per role | ✓ | Done 29.10 (phase 1): `staff` + `staff_roles` (schema v15), „Персонал“ in /admin. Codes 0001–8999; names as on the ID; roles waiter, manager, auditor with from/to dates; never deleted; every change in `audit_log`. |
| 7 | Unambiguous authentication | ✓ | Done 29.10: personal code + password; the shared password only until the first manager exists. Every `audit_log` row names its operator. |
| 8 | Real-time link with the printer; block opening sales and payments when it isn't ready; the УНП may use a printer seen within 2 hours | ✓ | Done 29.10 (phase 2): `state.php` says whether the printer is ready (bridge heard within 90 s, no printer error, clock right); phone ordering stops, a new bill and paying from the phone wait; staff see a red line. |
| 9 | УНП `XXXXXXXX-ZZZZ-0000001` generated when the sale is entered (shown on screen); sequence per printer; separate ranges when two programs share a printer | ◐ | Done 29.10: given when the order is placed (phone payment) or the bill opened (pay at the end), operator code 9001 "QR гост", one sequence per printer serial (`usn_counters`), shown on the order card and the bill. Left: separate ranges only matter if two programs share a printer (ours won't). To check on the real printer: several receipts of one bill under one УНП. |
| 10 | On a payment needing a receipt, command the printer, the receipt carrying the УНП; also on every payment and storno | ✓ | `_lib/fiscal.php` + bridge: receipt and reversal receipt with the УНП. |
| 11 | No service slips for orders within one sale | ✓ | Kitchen and bar see orders on screens; nothing printed. |
| 12 | Cancelling an open sale keeps full information (items, qty, value, operator) | ✓ | Cancellations and lines taken off are kept (`void_qty`, `cancel_reason`, `audit_log`), now with the operator and the sale's УНП. |
| 13 | No deletion of completed sales; storno kept | ✓ | Nothing deletes orders, payments or receipts; refunds are reversal receipts; `audit_log` refuses UPDATE and DELETE. |
| 14 | No non-fiscal document with the word "фискален" | ✓ | Checked 23.10.2026: none. (The e-receipt is off and uses "Електронна бележка".) |
| 15 | Structured log of operator actions: who, code, when, what. At least login/logout, storno, cancellation (with УНП), changes to catalogues, operator changes | ◐ | Done 29.10: operator code and name on every row; logins, failed logins, logouts; operator and role changes; settings and sold-out changes; УНП on orders, voids, bills, receipts. Left: **menu and price changes** (the menu is a JSON file changed by deploy, so each deploy has to write its changes into the log). |
| 16 | View of that log in the interface, filterable by period, operator and action | ✗ | A screen in `/admin` with filters (period, operator, kind of action). |
| 17 | Access through the interface to data for the statutory period (ДОПК чл. 38: 10 years); archives accessible | ◐ | „История“ reads every past evening. To add: guarantee 10-year retention and access (no pruning; archive copies readable from the interface). |
| 18 | Views and exports (XLS/XLSX/CSV) with filters (period, site, printer, workplace, operator) of NAP's tables 18.1–18.9 with fixed columns: sales summary, payments, sale details, storno, cancellations, catalogues; deliveries and stock movement only if the software has them | ✗ | Nine exports with the prescribed columns, net/VAT split, filters. Mechanical but sizeable. 18.6–18.8 (deliveries, stock) don't apply. |
| 19 | Auditor profile: read-only, access to 16–18, settings and all reports | ◐ | The "Проверяващ" role exists (29.10): reads everything, every change refused. Left: the screens of 16–18 it is for. |
| 20 | No test or training mode | ✗ | The declared version must have no test mode: no Stripe-test switch and no `fiscal_mode` "test". The tests and the sandbox stay outside the declared build. |
| 21 | If part of an integrated system that can't meet 16–19, the integrated system meets them | — | Not integrated with another system. |
| 22 | Automated import of sales follows Annexes 41/42 | — | We import nothing. If the QR orders ever had to be handed to Clock, that's Annex 41. |
| 23 | Export to other software allowed | ✓ | CSV exports exist; describe them. |

## Progress

- **Phase 1, 29.10.2026 (branch `feat/qr-ordering`, not deployed):**
  personal staff accounts and roles (6, 7, 19 in part), the operator on
  every log row (12, 15 in part), the УНП when the sale is entered (9).
- **Phase 2, 29.10.2026 (branch, not deployed):** no sale opened and no
  payment taken while the printer isn't ready (8); the bridge keeps the
  printer's clock right at start, daily and on drift, and phone payments
  stop past 5 minutes off (5).
- Next: (3) the log screen with filters and НАП's nine exports (16,
  18); (4) no test mode in the declared build, integrity checks (4, 20);
  (5) the transfer to Clock; (6) the manual and the Annex 31 information.

## The transfer to Clock (the condition)

Each phone payment, once its receipt has printed on our printer, goes to Clock
so Clock's reports hold the restaurant's whole turnover:
- **Clock's way:** the end-of-day transfer from their POS Guide. A folio on a
  company, the day's (or each bill's) items as charges, and the payment as
  already settled, then closed. This is the first Clock build (folio,
  `charges/bulk`, `credit_items`, `close`), parked in `_lib/clock.php`.
- **НАП's way of booking it** (control sheet 3.2): an imported sale is closed
  "с начин на плащане, неизискващ издаване на ФБ", named after its source,
  e.g. "Продажба чрез ФУ с ИН <our printer's number>", so Clock never prints
  a second receipt for it. Exchange between two "СУПТО" follows Annex 41
  (чл. 52з, ал. 9). That text isn't in `nap/` yet and is needed.
- **Clock's side:** their certification, a live API user, and a payment type
  that doesn't fiscalise. To be agreed with them.

## Two questions that shape the build

1. **Orders paid to the waiter.** Once ours is a registered "СУПТО", every
   QR order placed in it is a sale opened in it (т. 9), so its payment has to
   go through our system as well (cash, card at the terminal, on our printer),
   or be handed to Clock under Annex 41, which Clock doesn't offer. In
   practice our system becomes the till for **every** QR order, not just
   phone payments. The alternative, a QR menu that only shows the menu
   without taking orders on "При сервитьора" evenings, is to be decided.
2. **Versions.** Every change to the sales part or its database structure is
   a new version, with a new declaration within 7 days (чл. 52в, ал. 3 and
   3а). Changes to the sales part would come in planned releases, numbered
   by a declared scheme (Annex 31, II.9), not several deploys a week. The
   rest of the site (rooms, events, weddings) isn't affected.

## The registration itself (чл. 52в)

Filed by the producer with an electronic signature (КЕП) in НАП's e-services,
**before** the software is used:

- the declaration (Annex 30);
- information under Annex 31: modules, technology, delivery (here: a web
  application in the restaurant's own hosting at SuperHosting, Bulgaria, with
  a local component, the bridge), the database (SQLite), encryption, user
  authentication, how points 16–19 are met, protection against changes, and
  the version numbering;
- a detailed manual of the sales functions, describing **how every one of
  the 23 points is met, with screenshots** from a test database (the
  control sheet is explicit that a bare statement isn't enough);
- for software installed in the client's environment: a full description of
  the database tables and fields for sales, plus a program (or interface)
  that exports them in readable form.

НАП lists the software within 7 working days, or returns gaps to fix. After
that, RAYA (the user) files Annex 32 before starting to use it. The
accountant has offered to do the filing if we provide the technical part.

## Rough effort

- **Development:** 3–5 weeks. Separate staff accounts and roles, the УНП at
  ordering, blocking on printer readiness, the extended log and its screen,
  NAP's nine exports, the auditor profile, removing test mode from the
  declared build, time sync, and integrity checks. Plus the question of
  orders paid to the waiter.
- **Documentation:** the manual with screenshots, the Annex 31 information,
  and the database description: about a week alongside development.
- **НАП:** 7 working days, plus fixing whatever they return.
- **Hardware:** a fiscal printer that ErpNet.FP supports, registered for the
  restaurant, and a small computer for the bridge (`tools/fiscal-bridge/`).
