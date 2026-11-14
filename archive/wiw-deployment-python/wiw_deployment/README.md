# WiW → Deployment Workbook automation

Turns a When I Work schedule export into the morning deployment workbook:
one color-coded role block per hour for every scheduled person, with breaks
computed and placed automatically according to the rules below. Sales
goals and the Hourly Tracker section are never touched — those stay
whatever they were in the template you point the tool at.

## How it works, end to end

1. In When I Work: **Schedule → Day or Week view → Export**, and export the
   day's schedule as CSV (or Excel). This is a manual click each morning —
   there's no WiW API wired up here (that would need a paid plan with API
   access; ask if you want that path instead).
2. Run the tool against that export and your real deployment workbook:

   ```bash
   python -m wiw_deployment build \
       --wiw path/to/wiw_export.csv \
       --template path/to/your_deployment_master.xlsx \
       --sheet "Friday" \
       --date 2026-08-30 \
       --date-cell C1 \
       --output path/to/todays_deployment.xlsx
   ```

3. Open the output file, eyeball it, paste/copy the filled tab into the
   shared SharePoint workbook (or just use the output file directly).

`--template` should be a copy of your **actual** deployment workbook (or a
day-tab from it) — the tool opens it, writes into the roster/break/hourly
grid region, and saves a new file. Everything else in that workbook
(goals, Week/Month figures, the Hourly Tracker formulas, other tabs) is
left completely untouched.

Don't have a real file handy to test against yet? Generate a stand-in:

```bash
python -m wiw_deployment demo-template --output demo_template.xlsx
```

## Important: this was built without a real WiW export or your real workbook file

Two things were **not** verified against your actual data, because neither
was available to build against:

- **WiW's exact export column headers.** They vary by plan/export settings.
  The importer (`wiw_import.py`) matches headers case-insensitively against
  alias lists in `config.py` (`WIW_COLUMN_ALIASES`) rather than assuming one
  fixed layout, and it raises a clear error naming which field it couldn't
  find, plus the headers it did see. **The first time you run this against
  a real export, if it errors, just add your header text as an alias in
  `config.py` — no code changes needed.**
- **Your real workbook's exact cell layout.** The row/column numbers in
  `config.py` (`STAFF_START_ROW`, `COL_NAME`, `GRID_START_COL`,
  `GRID_START_HOUR`, etc.) were inferred from the example screenshot. If
  your real file's grid starts in a different row/column, or covers
  different hours, update those constants — everything else adapts
  automatically.

Both of these are one-time calibration steps, not ongoing maintenance.

## Break rules implemented

| Shift length | Breaks given |
|---|---|
| ≤ 5 hours | none |
| > 5 and < 6 hours | one 15-minute break |
| 6 – 8.5 hours | one 15-minute break + one 30-minute break |
| ≥ 8.5 hours | two 15-minute breaks + one 30-minute break |

Exact boundary handling (e.g. is a shift of *precisely* 6.0 hours in the
"one 15" tier or the "15+30" tier?) is a judgment call — see the named
constants and comments at the top of `config.py` (`NO_BREAK_MAX_HOURS`,
`ONE_FIFTEEN_MAX_HOURS`, `FIFTEEN_AND_THIRTY_MAX_HOURS`) if your actual
labor policy draws the line differently.

Breaks are spaced evenly across the workable part of each shift (a 30-minute
buffer at the start/end is left alone — no breaks right at open/close), and
never scheduled back-to-back with a person's other breaks.

## Floor coverage rules while placing breaks

While deciding *when* to place a break, the scheduler checks every minute of
the proposed break against the whole day's roster and rejects the slot if:

- Fewer than **2 people** would be on the floor (not on break) at that
  moment, or
- **Zero Floor Leads** would be on the floor at that moment, while at least
  one FL is scheduled to be working then (this also automatically prevents
  two Floor Leads from ever being on break at the same time — if FL #1 is
  already on break, placing FL #2's break at the same time would drop
  on-floor FLs to zero, which is rejected).

If no slot satisfies both rules (this can only happen in edge cases like a
day with only two people scheduled total, where any break inherently drops
the floor below the minimum), the break is still placed as close to ideal
as possible, but is **flagged**: written in red text in the output file and
listed as a warning on the command line, so a human reviews it rather than
the tool silently producing an under-staffed floor.

## Role scope (what's automated vs. what stays manual)

Each person gets **one** color block spanning their whole shift, using
whatever position When I Work has them assigned to (Floor Leader → `FL`,
Product Guide → `PG`, etc. — see `WIW_POSITION_ALIASES` in `config.py` to
add more). Finer-grained carve-outs some leaders add by hand — a Huddle at
open, Admin time at close, a Leadership Meeting, PROD/PG rotation through
the day — are **not** automated. Those still get added manually on top of
the generated file, same as today.

## Files

- `config.py` — every layout constant, role color, break-policy threshold,
  and WiW column/position alias. Start here to adapt the tool to your real
  files.
- `breaks.py` — break-tier lookup (`required_breaks`) and the placement
  algorithm (`BreakScheduler`).
- `wiw_import.py` — parses a WiW CSV/XLSX export into `Shift` objects.
- `workbook.py` — writes shifts into a workbook (`fill_workbook`) and can
  generate a stand-in template (`build_demo_template`).
- `cli.py` — the `build` / `demo-template` commands.
- `tests/` — unit tests for the break policy, the coverage-safety
  invariants (run `python -m pytest wiw_deployment/tests/ -v`), and the
  importer.
- `samples/sample_wiw_export.csv` — a synthetic WiW-style export (based on
  the names/shifts in the example screenshot) for trying the tool without
  a real export on hand.

## Try it now with the sample data

```bash
python -m wiw_deployment demo-template --output demo_template.xlsx
python -m wiw_deployment build \
    --wiw wiw_deployment/samples/sample_wiw_export.csv \
    --template demo_template.xlsx \
    --sheet Demo \
    --date 2026-08-30 \
    --date-cell C1 \
    --output filled_demo.xlsx
```
