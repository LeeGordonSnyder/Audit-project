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

## Running alongside the original app

The original app (`Audit-project`, branch `claude/arctteryx-tag-lookup-app-anuv34`)
**keeps running exactly as it is**. This repo does not modify it, and you
don't have to redeploy anything:

- **Same backend, unchanged.** v2 calls the same Apps Script deployment with
  the same request types and payloads. `Code.gs` is not modified and needs
  no redeploy. Both apps read and write the same Google Sheet, so data entered
  in either one shows up in both.
- **Separate local storage.** Both apps will most likely be served from the
  same `github.io` origin, which means they share one `localStorage`. Every v2
  key uses an `ops2.` prefix, and v2 never writes to the original app's
  `audit.*` keys. The only crossover is **read-only**: if v2 has no Sheet URL
  or access key of its own yet, it borrows the original app's, so a phone
  that's already set up works with no extra setup.
- **Separate offline cache.** v2's service worker only cleans up caches named
  `ops2-*`, so it can never break the original app offline. (The original
  app's worker deletes every cache that isn't its own when it updates. v2
  handles that by re-fetching and re-caching on the next request.)
- **Separate home-screen app.** It's a different URL path
  (`/Oakridge-product-suite/` vs `/Audit-project/`), so staff can have both
  icons installed during the transition.
- **Feedback is tagged.** Feedback sent from v2 is prefixed `[v2]` in the
  Feedback sheet.

## Replacing the original app

The store phones get v2 when these files are published at the original app's
address (`Audit-project`, branch `claude/arctteryx-tag-lookup-app-anuv34`).
Same address, so nothing changes on the phones:

- The home-screen icon stays. The original app shows its **"A new version is
  ready"** banner. Tap **Reload** and v2 opens.
- The access key and roster are picked up from the original app, so nobody
  re-enters anything. Each person picks their initials once.
- **Work staged on the phone carries over once:** counts not yet saved to the
  sheet, and anything held in Consolidations, Receiving, Check Floor or Replen.
  It shows up on Home to finish. The original app's data is left untouched, so
  rolling back loses nothing. This only happens at the `/Audit-project/`
  address, never when v2 runs side by side.
- **Rolling back:** the original app's last version is saved on the
  `original-app-final` branch of the Audit-project repo. Restore those files on
  the live branch and the phones go back the same way.

## Deploying (GitHub Pages)

1. **Settings → Pages → Build and deployment → Deploy from a branch**, then
   pick the branch and `/ (root)`. On the free plan the repository must be
   **public**, same as the original.
2. Open `https://<username>.github.io/Oakridge-product-suite/` in **Safari**,
   then Share → **Add to Home Screen**.
3. The first sign-in on each phone asks for the **access key** (the
   `ACCESS_KEY` Script Property). It's checked against the sheet before it's
   saved. iOS keeps home-screen apps' storage separate from Safari, so expect
   to enter it once on each installed icon, even if the original app already
   has it. It can be changed later under ⚙︎ Settings.

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
