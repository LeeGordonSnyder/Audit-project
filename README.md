# Oakridge Product Suite

The store operations web app for the Oakridge Park team: one **Home** screen
that surfaces what needs attention, a shared to-do list and each person's
shift for the day, and **five focused modules** in place of the original app's
seven tabs. It runs on the store iPhones from GitHub Pages and keeps its data
in a shared Google Sheet.

| Module | Replaces (original app) |
| --- | --- |
| **Home**: exception feed, weekly KPIs, quick scan actions | *(new)* |
| **Product Catalog**: one search, product detail, hard-tag placement, MAO import | Tag Lookup + Product Master |
| **Counts**: scan-to-count, tolerance flagging, batched Save to Sheet | Audit Dashboard |
| **Consolidations**: Holding → Update, Actual Count stepper, Close a Box | Consolidations |
| **Receiving**: Physically Received → Received into MAO, plus a *Waiting on MAO* queue | Receiving Log |
| **Floor Stock**: Check Floor / Replen / 86 Board as one lifecycle | Floor Replen + 86 Board |

Settings, the staff roster and Feedback live in the ⚙︎ modal, reachable from
any screen.

## Where it lives

The store phones load the app from GitHub Pages at
`https://leegordonsnyder.github.io/Audit-project/`, published from **`main`**.
Pushing to `main` updates the phones.

```
index.html, css/, js/, icons/, sw.js, manifest.webmanifest   the app (served by Pages)
backend/      Apps Script add-ons for the shared Google Sheet: daily deployment, to-do list
docs/         staff guides (PDF), the rebuild plan, the original app's README with Code.gs
tools/        scripts that make the guides, the showcase video and screenshots
workbooks/    standalone Excel workbooks from before the app
archive/      retired tools, kept for reference
```

Branches:

- `main`: everything above. The only branch you need.
- `archive/original-app`: the original seven-tab app, kept for rolling back.
  Restore its files on `main` and the phones go back the same way.

The rebuild was first developed in a separate repository; its history is part
of `main`. The two promo videos from that time are in history only:
`git show 2146a95:docs/media/oakridge-product-suite-motion.mp4 > motion.mp4`.

How v2 took over from the original app on the phones:

- **Same backend.** v2 calls the same Apps Script deployment and the same
  Google Sheet. `Code.gs` is unchanged; its source is in
  `docs/ORIGINAL-APP-README.md`.
- **Its own storage keys.** Every v2 key uses an `ops2.` prefix and v2 never
  writes to the original app's `audit.*` keys. It reads the original app's
  access key and roster, so nobody had to re-enter them.
- **Work staged on a phone carried over once:** counts not yet saved to the
  sheet, and anything held in Consolidations, Receiving, Check Floor or Replen.
  The original app's data is left untouched.
- **Feedback is tagged.** Feedback sent from v2 is prefixed `[v2]` in the
  Feedback sheet.

## Deploying (GitHub Pages)

1. **Settings → Pages → Build and deployment → Deploy from a branch**, then
   pick `main` and `/ (root)`. On the free plan the repository must be
   **public**, same as the original.
2. Open `https://leegordonsnyder.github.io/Audit-project/` in **Safari**,
   then Share → **Add to Home Screen**.
3. The first sign-in on each phone asks for the **access key** (the
   `ACCESS_KEY` Script Property). It's checked against the sheet before it's
   saved. iOS keeps home-screen apps' storage separate from Safari, so expect
   to enter it once on each installed icon. It can be changed later under
   ⚙︎ Settings.

After each shipped change, bump `CACHE_VERSION` in `sw.js` and the version
label in `index.html`. Phones then show the "A new version is ready" banner.

## Local development

No build step. Serve the folder over HTTP (the service worker and camera need
it):

```bash
python3 -m http.server 8000
```

## Code layout

```
index.html            shell: header, views, bottom nav, modals
css/app.css
js/core/              utils, store (keys + parsers), api (backend calls),
                      data (sheet loaders), ui, scanner, exceptions, router
js/modules/           home, catalog, counts, consol, receiving, floor,
                      login, settings
js/app.js             boot: roster → sign-in → load sheets → init views
sw.js                 offline app shell (ops2-* caches only)
```

`js/core/exceptions.js` is the Exception & Confirmation Engine. It is the
single place that decides what appears on Home and in the nav badge.

## Staff guides

Step-by-step PDF guides live in [`docs/guides/`](docs/guides/): a Getting
Started guide (sign-in, access key, settings, updates) and one guide per page.
Each page in the app links to its own guide, and Settings links to Getting
Started. To regenerate them after a change (screenshots are captured from the
real app against sample data, never the live sheet):

```bash
python3 -m http.server 8765 &        # from the repo root
node tools/guides/shots.js           # needs Playwright
python3 tools/guides/build.py docs/guides icons/icon-512.png
```

See [`docs/REBUILD.md`](docs/REBUILD.md) for the phased plan and what's done.
