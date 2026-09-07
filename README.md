# Store Audit Tool

An offline-friendly web app for store associates: look up security-tag
placement by style, run physical inventory counts against Manhattan Omni's
expected counts, and track the resulting Mark In/Mark Out adjustments until a
supervisor resolves them. No backend — it's static files that install to the
home screen like an app via Safari's "Add to Home Screen." All data lives on
the device (`localStorage`); there is nothing to configure to get started.

## The four tabs

### 1. Product Master
Paste a block (or several) copied straight out of Manhattan Omni into the
text box and tap **Import / Update**. Each block looks like:

```
Atom SL Hoody Men's
SKUX000009560002
DeptM
StyleX000009560
ColorBlack
SizeXS
UPC623555583288
Available0 / 0
```

The app parses SKU, Style, Color, Size, UPC, and the first number of
`Available x / x` as the expected on-hand count, then merges Color and Size
into the description shown in the table (e.g. *"Atom SL Hoody Men's — Black /
XS"*). Matching is by SKU: pasting the same SKU again **only refreshes its
expected count** — it never creates a duplicate row. That's the intended way
to keep counts current: re-paste from Manhattan Omni whenever you start a new
audit on a product.

The table is filterable (SKU, UPC, style, or description) and exportable to
CSV.

### 2. Tag Lookup
Scan or search a product to see the security-tag placement assigned to its
**style** (a "hard tag" — one location applies to every color and size under
that style code, e.g. style `X000009560` → "Thigh pocket" for every
Atom SL Hoody variant). Tap **Set / Edit Tag Location** on any result to
assign or change it. A running list of every assigned style/location pair is
shown below the search box for quick reference.

There's no HQ-exception feed wired up (Manhattan Omni doesn't carry one) — if
you need to note something item-specific, put it directly in that style's
tag-location text (e.g. *"Thigh pocket — do NOT pin through the mesh liner"*).

### 3. Audit Dashboard
This is the daily driver:

1. Set **Date** and **Initials** once — they're remembered until you change
   them again.
2. Tap **📷 Scan Product to Count**, scan the UPC. The app pulls the
   description and expected count from the Product Master list.
3. Enter the physical count and tap **Log Count**.
4. If the count matches, that's it — logged, no further action.
5. If it doesn't match, the item is automatically queued on the **Adjustments**
   tab: counted *more* than expected → **Mark In**; counted *less* → **Mark
   Out**.

The **🏷 Check Tag Location** button is a separate, non-destructive shortcut —
scan a UPC to see its assigned tag location without starting a count, useful
mid-audit when you just need a quick answer.

Recent entries are listed below and exportable to CSV.

### 4. Adjustments
Two queues, **Mark In** and **Mark Out**, populated automatically by the
Audit Dashboard whenever a count doesn't match. Each entry shows the
variance, and has a Supervisor Initials field and a Completed checkbox.
Checking it off requires initials first, and stamps the current date next to
it — that's the record that the correction was actually made in Manhattan.
Exportable to CSV.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source** → **Deploy from a
   branch** → pick your branch and `/ (root)`. Save.
   - GitHub Pages requires the repository to be **public** on the free plan.
     Private repos need GitHub Pro/Team, and even then the published site
     itself is a public URL (private Pages sites need Enterprise) — so for a
     tool with no sensitive data in it, a public repo is the simplest path.
3. Wait ~1 minute, then open the URL GitHub gives you
   (`https://<username>.github.io/<repo-name>/`).

## Installing on the store iPhone

1. Open the GitHub Pages URL in **Safari** (not Chrome — Add to Home Screen
   needs Safari to behave like a real app icon).
2. Share icon → **Add to Home Screen** → Add.
3. Launch from the home screen icon — full-screen, no browser chrome, works
   offline after the first load.

If you rename the app again later, remove the old home-screen icon and
re-add it — iOS caches the name/icon from whatever was live at install time.

## Data & backups

Everything (Product Master, tag assignments, audit entries, adjustments)
lives in the browser's `localStorage` **on that one device**. There's no
sync between phones — this only works because the whole workflow (paste data,
scan, count, resolve adjustments) happens on the same iPhone. Nothing is
lost between sessions, but:

- It doesn't survive "Clear website data" in Safari, a factory reset, or
  switching to a different phone.
- Use the **Export CSV** buttons (Product Master, Audit Dashboard,
  Adjustments) regularly as your durable record — treat them as the backup,
  since there's no server storing this anywhere else.

If you later need a supervisor to resolve adjustments from a different
device than the one doing the scanning, that requires wiring the app to a
shared backend (e.g. a live Google Sheet) instead of `localStorage` — a
bigger change, worth doing once this workflow is validated.

## Roadmap

This is a standalone prototype, not connected to Manhattan (no store-level
API access exists today) — Product Master data comes in via copy/paste
because that's the only access an associate has. If this proves useful, the
natural next step is pitching retail ops on a real Manhattan integration so
counts, tag rules, and adjustments live in the system of record instead of
being bridged by hand.

## Local development

No build step. Serve the folder over HTTP (not `file://` — the service
worker and camera access both require it):

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.
