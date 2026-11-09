# Oakridge Product Suite — Rebuild (v2)

The next version of the Oakridge Product Suite, built from the Rebuild Proposal:
one **Home** screen that surfaces what needs attention, and **five focused
modules** in place of the original seven tabs.

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

This repository is the only home of the app. The store phones load it from
GitHub Pages at `https://leegordonsnyder.github.io/Audit-project/`, published
from the branch `claude/arctteryx-tag-lookup-app-anuv34`. Pushing to that
branch updates the phones.

Other branches:

- `original-app-final`: the original seven-tab app, kept for rolling back.
  Restore its files on the live branch and the phones go back the same way.
- `rebuild-history`: the full commit history of the rebuild, from when it was
  developed in a separate repository (including the promo videos in
  `docs/media`).

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
   pick the branch and `/ (root)`. On the free plan the repository must be
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
