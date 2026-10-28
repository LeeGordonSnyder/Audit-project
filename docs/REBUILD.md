# Rebuild plan & status

Source: *Oakridge Product Suite — Rebuild Proposal* (13-page vision doc, Oct 2026).
It has six principles: paste-first data, one home, group by workflow,
confirm every handoff to MAO, offline by default, and the least machinery
that solves the problem.

## Phase 1 — done in this repo

Highest leverage, lowest risk: mostly reorganizing what already exists.

- [x] **Home + exception feed**, computed on the device from data already
      pulled from the sheet:
  - boxes physically received 1+ day ago but not received into MAO
  - latest count per SKU (last 14 days) outside tolerance: more than
    ±2 units or ±5%, whichever is larger
  - counts logged on this phone but not saved to the sheet
  - consolidation items left in Holding (flagged after 1 day)
  - legacy "Needs Adjustment" consolidation entries still unresolved
  - Floor Stock items still "Needed" after 3+ days
  - decisions staged in Receiving, Check Floor or Replen but not pushed
  - sheet data more than 24h old
- [x] **KPI tiles**: this week's count accuracy, open consolidation lines,
      boxes received this week, 86 Board count
- [x] **Quick actions**: Scan to Count, Scan Packing Slip, Scan Boxes
- [x] **In-app badge** on Home (and the home-screen icon where iOS/Android allow it)
- [x] **Product Catalog**: Tag Lookup and Product Master merged; one shared
      search used by Catalog, Counts and Floor Stock; product detail view with
      hard-tag assignment and recent counts
- [x] **Floor Stock**: Check Floor, Replen and 86 Board merged into one module
      with a lifecycle progress strip on every line
  - Check Floor shows **one line per style + color**, ignoring size. Staff
    look at that style on the floor and pick the sizes that are needed. On
    Update, the line becomes per-row decisions on the sheet: sold rows in a
    picked size → Needed; other sold rows → Not Needed; picked sizes with no
    sold row → new Needed rows. Replen is grouped the same way, with
    Picked / Out of stock still per size
- [x] **MAO confirmation generalized to Receiving**: a *Waiting on MAO* queue
      with "Hold all" so those boxes can be marked Received into MAO in one tap
- [x] Runs side by side with the original app: same backend, isolated
      storage and cache (see README)

Small additions made along the way: a typed-reference fallback for Close a
Box (for when the slip won't scan), and filter chips on Counts (All /
Outside tolerance / Not saved).

## Added: daily deployment from When I Work

- [x] `backend/Deployment.gs`: a separate Apps Script file plus a one-line hook,
      so the original app is unaffected. It builds a color-coded **Deployment**
      tab each morning from the store's When I Work schedule link, places breaks
      automatically under the floor-coverage rules, and stays hand-editable.
      Setup steps are in `backend/README.md`.
- [x] **Hourly Tracker** under the grid: sales target, total, AOV, UPT,
      transactions and traffic per hour, with Sales % and Conversion
      formulas and a CLOSE column. It survives a same-day rebuild.
- [x] **Hourly Notes** under the tracker: one large wrapping text box per
      hour, kept on a same-day rebuild.
- [x] **Goals and sales**: Goal / Strive / Week / Month across the top (the
      monthly goal is set once a month from the menu), hourly targets from a
      % of sales table, and an **Items sold** box where the MAO export is
      pasted to fill Total, Transactions and UPT. Re-pasting never
      double-counts.
- [x] App: a **Your shift today** card on Home (roles, times, breaks, a "now"
      marker), read from the Deployment tab. It stays hidden until the add-on
      is installed.

## Phase 2 — next

- [ ] Configurable count tolerance (currently fixed in `exceptions.js`
      `COUNT_TOLERANCE`) and a week-over-week accuracy trend
- [ ] Associate / Lead roles (Lead sees accuracy and shrink KPIs, manages the
      access key, sees device and version info)
- [ ] Audio and haptic feedback on a successful scan
- [ ] Consolidation event grouping (tag each HQ batch by when it was requested)
- [ ] **Close-a-Box tracked confirmation.** Today the MAO reminder is a modal
      you must acknowledge, same as the original app. Making it a tracked
      item that stays open until confirmed needs a place in the sheet to store
      "confirmed in MAO". That is an **additive** `Code.gs` change (a new
      request type plus a column on ConsolLog). The original app never sends
      that request type, so it would be unaffected, but it does need a script
      redeploy. That's why it isn't in Phase 1.

## Phase 3 — later

- [ ] "Someone else changed this since you loaded it" notice before saving
      over another device's change
- [ ] Per-device access keys (so one lost phone can be revoked) instead of
      one shared key
- [ ] Revisit the backend only if this goes multi-store

## Deliberately out of scope

Native push notifications, RFID, demand forecasting, multi-store management,
in-app chat, and a Manhattan API integration (until HQ grants access).

## Cutover (when ready)

1. Staff use v2 alongside the original app. Watch `[v2]` feedback in the
   Feedback sheet.
2. When v2 covers everything, tell staff to switch icons. The original app
   stays deployed as a fallback, untouched.
3. Before retiring the original, make sure no phone still has unsaved counts
   in it: Audit Dashboard → Save to Sheet on each device.
