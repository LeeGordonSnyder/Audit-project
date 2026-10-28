# Backend add-on: daily deployment from When I Work

`Deployment.gs` adds a color-coded **Deployment** tab to the shared Google
Sheet, built every morning from the store's When I Work "entire schedule"
calendar link, and lets the app show each person their own shift for the day.

It is a separate file in the existing Apps Script project, plus **one line**
in `Code.gs`. Nothing else in `Code.gs` changes, so the original app keeps
working exactly as before.

## Install (one time, about 10 minutes)

1. **Open the script.** In the Google Sheet, go to **Extensions → Apps Script**.
2. **Add the file.** Click **+** next to *Files* → **Script**, name it `Deployment`,
   and paste in the whole of `backend/Deployment.gs`.
3. **Add the hook in `Code.gs`.** Find `function computeDoGetResult(sheetParam) {`
   and add this as its first line:

   ```javascript
   if (sheetParam === "deployment") return getDeploymentForApp();
   ```

   If `Code.gs` already has its own `function onOpen()`, rename the one in
   `Deployment.gs` to `deployOnOpen` and call `deployOnOpen()` from inside the
   existing `onOpen`. (The current `Code.gs` doesn't have one.)
4. **Set the time zone.** Open **Project Settings** (gear icon) and set the time
   zone to **(GMT-07:00) Pacific Time – Vancouver**.
5. **Redeploy.** Go to **Deploy → Manage deployments** → edit (pencil) → *Version:*
   **New version** → **Deploy**. Keep the same deployment, so the URL doesn't change.
6. **Authorize.** Reload the Sheet. A new **Deployment** menu appears. Choose
   **Set up deployment tabs** and approve the permission prompt. The script now
   needs to fetch the When I Work schedule (`UrlFetchApp`) and run the daily
   trigger.
7. **Set the When I Work link.** A manager's When I Work account has an
   "entire schedule" calendar link (it ends in `/global.ics`). Choose
   **Deployment → Set the When I Work link…** and paste it. It's checked and
   then stored in the script, not in the sheet. The confirmation says how many
   people it found, and warns you if any two of them share initials (see
   below). The link covers about the next 4 weeks.
8. **Build the first day.** Choose **Deployment → Build today's deployment**.
9. **Turn on the daily build.** Choose **Deployment → Turn on daily auto-build**.
   From then on the tab builds itself around 5am every day.

## Day to day

- **Touching cells with the same code show as one block.** The code is
  written once, at the start, with no lines inside the block (hour lines
  stay). Every cell still holds its code, so editing works as before. Put a
  different code inside a block (a `B`, say) and it splits into two blocks
  around it.
- **Leads can edit on the fly.** Type a code into any grid cell (`FL`, `PG`,
  `PROD`, `B`, …). The color follows the code automatically. Select several
  cells, type, and press **Ctrl/Cmd + Enter** to fill them all at once.
  Everything after 5am is hand-editable.
- **Moving a break works either way.** Type a new time in **BREAK** or
  **15 MIN** (`1:00`, `1p` and `1:00 PM` all work), and that person's **B**
  cells move on the grid; the role they had there fills the old slot.
  Or move the B cells on the grid, and the break times update to match.
  A time that can't be read, or that falls outside the person's shift, is
  left as typed for you to fix.
  Breaks can sit right next to each other (a 15 straight before a 30), and
  quick edits one after another are handled in order, so none is undone. This needs the edit trigger, which the
  first build after updating `Deployment.gs` installs automatically.
- **Edits are safe from the auto-build.** It never touches a day that's
  already been built. **Build today's deployment** from the menu does rebuild
  it, and asks first. A rebuild replaces the grid, keeps the Hourly Tracker
  numbers, and clears anything else added to the tab by hand.
- **Previous days are kept, out of the way.** When a new day is built,
  yesterday's tab is renamed `Deployment YYYY-MM-DD` and **hidden**, so the
  tab bar only shows today. To look at an earlier day, open **View → Hidden
  sheets** (or right-click the tab bar) and choose it. Hidden days older than
  7 days are deleted automatically (`DEPLOY.ARCHIVE_KEEP_DAYS`).
- **Break cells a shift doesn't get are grey**, like the paper template. To
  mark a break as taken, strike it through (Alt + Shift + 5 on Windows,
  Cmd + Shift + X on a Mac). The
  strike-through stays.
- **Breaks are placed automatically**, by shift length:

  | Shift length | Breaks |
  |---|---|
  | under 3h | none |
  | 3h to under 5.5h | one 15 |
  | 5.5h to 8h | a 15 and a 30 |
  | over 8h | two 15s and a 30 |

  No break falls in the first or last 30 minutes of a shift. At least two
  people stay on the floor, and at least one Floor Lead whenever one is
  scheduled. A break that can't meet those rules is still placed, but its
  cell is tinted red with a note, so a lead can check it.
- **Change the codes in one place.** The **Deployment Codes** tab holds each
  code's color and meaning, and which When I Work positions map to it (for
  example *Product Operations → PROD*). Edit it there. New codes and colors
  apply from the next build; colors on today's tab update when it's rebuilt.

## Goals

Across the top of every deployment:

| Box | What it is |
|---|---|
| **Goal** (yellow) | Today's sales goal. Type it in each day. |
| **Strive** | Goal × 1.4, worked out for you. |
| **Week** | This week's goal. Type it in on any day, and it carries over to each new day until Sunday. Monday starts blank. |
| **Month** | Set once with **Deployment → Set monthly goal…**, and it shows on every deployment that month. On the 1st of a new month it shows a red **UPDATE** until the new month's goal is set. |

## Store hours and % of sales

These two small tables sit on the **Deployment Codes** tab, to the right of
the codes:

- **Store hours**: when the store opens and closes each day of the week. The
  Hourly Tracker and Hourly Notes have one column for each hour from **8am**
  to close, then **CLOSE**. The 8am and 9am columns catch pre-open employee
  purchases. They use the same formulas as every other hour.
- **% of sales**: each hour's share of the daily goal. An hour's **Sales
  Target** is Goal × its %, and the CLOSE target is the Goal.

They start with the store's hours (Mon–Wed 10am–7pm, Thu–Sat 10am–9pm,
Sun 11am–7pm) and 10 / 10 / 15 / 15 / 20 / 20 / 10 / 10 / 10% for 10am–6pm.
8am, 9am, 7pm and 8pm have no %, so those hours get no target until you
fill one in. Their sales still count toward the CLOSE total. Edit either table and the next build uses it. The table's
**Total** shows what the hours add up to. As set now that's 120%, so the
hourly targets add up to more than the Goal.

## Hourly Tracker

Each build adds an **Hourly Tracker** under the staff rows. It has a column
for each open hour, each sitting under that hour on the grid, plus a
**CLOSE** column.

| Row | Each hour | CLOSE |
|---|---|---|
| Floor Lead | filled from the grid: who's on FL that hour | — |
| % of sales | from the % of sales table | sum |
| Sales Target | Goal × % of sales | the Goal |
| Total | from the pasted MAO export | sum |
| Sales % | Total ÷ Sales Target | Total ÷ Goal |
| AOV | Total ÷ Transactions | day's Total ÷ Transactions |
| UPT | units ÷ transactions, from the export | day's units ÷ transactions |
| Transactions | from the export | sum |
| Traffic | typed in | sum |
| Conversion | Transactions ÷ Traffic | day's Transactions ÷ Traffic |

Formula cells stay blank until their numbers are in, so there are no
`#DIV/0!` errors.

- **Rebuilding the same day** keeps the Goal, the Week goal, Traffic and the
  notes. Sales are filled back in from what's been pasted.
- **Yesterday's numbers** stay on its archived (hidden) `Deployment YYYY-MM-DD` tab.

## Pasting sales from MAO

To the right of the legend there's an **Items sold (MAO export)** box.

1. In MAO, export the **Items Sold** report and copy the rows. Including the
   header row is fine, and so is leaving it out.
2. Click the **yellow cell** and paste (Ctrl/Cmd + V).
3. The rows disappear. The tracker's Total, Transactions and UPT update for
   every hour, and the line above the box shows the day so far.

How the export is read:

- **One sale:** items with the same *Creation Time*, to the second, are one
  transaction. Units come from *Quantity Sold*, and each line is worth
  *In Store Price* × quantity.
- **Returns:** a negative quantity takes its value off that hour. A return
  on its own doesn't count as a sale.
- **Outside opening hours:** a sale before opening counts in the first hour,
  and one after closing in the last.
- **Other days:** rows from another day are ignored, and the box says so.

**Paste as often as you like.** Pasted sales are kept on a hidden **Sales
Log** tab, for the same 7 days as the archives. A new paste replaces every
sale in the time span it covers, so either way works:

- paste each hour's new sales as you go;
- paste the whole day so far at any point;
- paste everything once at close.

Pasting the same sales twice never counts them twice.

**If a wrong export was pasted** (for example, from a computer on another time
zone, which shifts every sale into the wrong hour), choose **Deployment → Clear
today's pasted sales…** and paste the correct export. Pasting the correct one
over the wrong one isn't enough, because a paste only replaces the time span it
covers. A paste with sales well outside 8am to close shows a warning, so a
shifted export is caught straight away. An hour stays blank
until the store has had a sale in it or a later hour.

## Hourly Notes

Under the tracker, **Hourly Notes** has one large text box for each open
hour, each under its hour on the grid. Click a box and type. Text wraps
inside it, and you can drag the row taller if a day needs more room.

- **Rebuilding the same day** keeps every note.
- **A new day** starts with empty boxes.
- **Box height** is set by `DEPLOY.NOTES.BOX_HEIGHT`.

## What the app shows

On Home, the signed-in person sees **Your shift today**: start and finish
times, a colored timeline of their roles and breaks with a marker for "now",
and each block listed with its times. It reads the Deployment tab as it
stands. The app re-checks it whenever it's reopened or brought back on
screen (if it's been more than 2 minutes), and every few minutes while it's
open, so a lead's change reaches people's phones within a few minutes.
↻ pulls it immediately.

The app matches people by **initials taken from their name on the grid**:
the first letter of the first and last names, so "Li Snyder" is LS. This
matches the initials people sign in with. Someone a lead adds to the grid by
hand is matched the same way.

If two people on the day's grid share initials (say, two "JV"s), the app
asks each of them once which name is theirs and remembers it on that phone.
A "Not you?" link undoes the choice. The build and the link setup both point
out shared initials, so nothing needs setting up for it.

## Privacy

The "entire schedule" link lets anyone who has it see **everyone's**
schedule. It's kept in the script's properties, not in the sheet, so only
script editors can see it, and the app never receives it. If it's ever
shared by mistake, the manager can reset it in When I Work and set the new
one with **Deployment → Set the When I Work link…**.
