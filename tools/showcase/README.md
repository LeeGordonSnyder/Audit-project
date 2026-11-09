# Showcase (staff-meeting reveal)

Stills and, later, the animated tutorial for presenting the app.

- `capture.js`: fresh full-screen iPhone 15 Pro captures (393×852 pt at 3×) of every
  screen used in the video, against the mocked backend in
  `tools/guides/mockdata.js`. The clock is fixed at 11:20am so the shift card shows
  "now". Serve the repo root on :8765, then `node tools/showcase/capture.js`.
- `frames/style.html`: the style frames. Each `<section>` is one 1920×1080 frame.
  `node tools/showcase/render.js` writes them to `out/` (git-ignored).
- `frames/sheets/`: real Google Sheets screenshots for the monitor shots. They show
  staff names, so the folder is git-ignored and stays on your machine.

Look: white background, near-black text (#1D1D1F) with grey for secondary text, Inter /
Inter Display. The app is shown on an iPhone and anything in Sheets on a monitor.
The old ways are grey line drawings.

## The video

`video/index.html` + `video/scenes.js`: the animated showcase, about 6 minutes, with no
narration yet. Every frame is a function of time (`renderAt(t)`), so it renders
the same way every time.

```bash
cd tools/showcase/video
node render.js stills 42 157 240          # check single moments (seconds)
node render.js video 30 4                 # full render -> out/showcase.mp4
```

The six acts follow the frame list: the reveal, the old ways, Before / Now, each
function up close (the camera zooms to the boxes in `screens/rects.json`), behind
it all (Sheets on a monitor, plus the shift card), and the close. The monitor shots
need `frames/sheets/deployment-full.png`, a real screenshot kept local.
