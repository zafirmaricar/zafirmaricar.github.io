# zafirmaricar.github.io

Personal portfolio of Zafir Maricar. Plain HTML, CSS and JavaScript with no build step.

Rain falls over the page as a real-time 2D particle fluid. Every content panel
is drawn as a rock and acts as a collider, so water pools on top of the panels
and runs off their edges. Move the cursor through the water to push it, and
click empty space to splash. The big rock at the top of Home (class `pond`)
has two ponds on top instead of a dome. A shallow basin over the title ends
in a ridge, then the top drops to a second, lower pond right of the title,
with a lip at the right edge, so the rain collects in one and spills into the
other. `main.js` places the drop from the text: right of every line above the
pond and just above the first line it would cut into (on narrow phones it
keeps a single pond when there's no room).

Rocks can be broken. Clicking a rock cracks it open at that spot, and a second hit
on the same spot breaks that chunk off. The chunk is sized to the rock where
it was hit: out in solid rock it's a big piece, but on a thin neck left between
holes or a strip along an edge it's only about as wide as that piece, so it
doesn't tear a big bite out of the rock around it. The first hit measures this
as the shortest line through the spot that stays in solid rock. A small piece
of rock on its own (up to 6000 px², or one that hangs on only by threads a few
px thin) is never chipped into smaller bits: the first hit cracks it all over
and the second takes all of it. The chunk carries the
text it covered, falls as a rigid body, bounces off the rocks below and pushes
the water aside until it drops off the page. "Repair rocks" restores everything.

The "TNT" switch next to it turns clicks on rock into bombs. A bundle of
dynamite sticks where you click and its fuse burns for 3 seconds. Then it
blows a hole about 280 px across (200 px on phones) in every rock it reaches.
The rock next to the bomb turns to dust, and the rest is thrown out as five to
seven huge chunks that carry their text. The blast also throws the water, the
ducks and any falling chunks, and sets off any other bomb it reaches. Chunks are cut
along rays from the centre (`Rocks.carve`), so a piece holds only solid rock:
no air from the pond's basin or from earlier holes.

Rubber ducks ride the rain: while there are fewer than three on the page, a
new one drops in every 7 seconds. Each duck is a light rigid body. Probes
round its hull feel the nearby water, lifting it where the water is deep
enough and dragging it along with the flow, so ducks float where water pools
on the rocks and get carried off by the streams. They bounce off rocks and
falling chunks, the water flows around them, and clicking one makes it hop.

On phones, gravity for the water and the ducks points at the real ground,
worked out from the phone's orientation (`deviceorientation`), so tipping the
phone side to side slants the rain, pours the pooled water off the rocks and
slides the ducks along. The rain then comes in through the top and the upwind
side of the screen. Broken-off chunks still fall straight down. Tilt is on
from the start, and a "Tilt" button next to "Repair rocks" turns it off and
on. Android needs no permission. iOS only shares orientation after asking,
and only shows its prompt from a tap, so the page asks on arrival (which
works if this visit already answered) and then on the first tap anywhere; if
access is refused the button is struck out. Desktops never show the button.

The Projects tab shows each project's images and clips from the old Google
Site. The GIFs are converted to short looping videos (H.264 MP4 with a VP9
WebM fallback), which load and play only while on screen. Projects with
several items get a small gallery like the old site's carousels. Media can be
cracked and broken off like the rest of the rock; the cracks are drawn over it
too. A featured card across the top links to the Pixel Nuclear Reactor
(below).

The simulation runs at a fixed 60 steps per second, so high-refresh screens
don't speed it up and 30 Hz screens don't slow it down.

## Structure

- `index.html`: all content, with three tabs (Home, Projects, Resume)
- `css/style.css`: styles; panels fall back to plain stone cards without WebGL
- `js/fluid.js`: the fluid simulation (double density relaxation, Clavet et al. 2005) with a uniform-grid neighbour search
- `js/rocks.js`: rock outlines around each `.rock` panel, collision queries (including holes), and fracture geometry
- `js/renderer.js`: WebGL rendering of the rocks (procedural stone, bevel lighting) and the fluid (screen-space metaballs)
- `js/fracture.js`: cracks, broken-off chunks (rigid bodies with the panel text cloned and clipped) and per-panel damage
- `js/ducks.js`: rubber ducks (rigid bodies with buoyancy probes) and their sprite
- `js/tnt.js`: TNT bombs: planting, the burning fuse, chain reactions and the explosion effects
- `js/media.js`: project media: clips that play only on screen, gallery thumbnails, and the YouTube poster that loads the player when tapped
- `js/main.js`: tabs, rain, pointer input, phone tilt and the 60 fps main loop
- `assets/docs/Zafir_Maricar_Resume.pdf`: the resume shown on the Resume tab, exported from the resume's Google Doc
- `assets/img/projects/`: project media. Each clip is `<name>.mp4` + `<name>.webm` with a `<name>.webp` poster (its first frame); stills are `<name>.webp` (at most 960 px wide); gallery thumbnails are `<name>-thumb.webp` (92 px tall, taken 40% into a clip). Clips were made from the GIFs with
  `ffmpeg -i in.gif -an -vf scale=W:-2:flags=lanczos,setsar=1,format=yuv420p -c:v libx264 -preset veryslow -crf 26 -profile:v high -movflags +faststart out.mp4`
  and the WebM with
  `ffmpeg -i in.gif -an -vf scale=W:-2:flags=lanczos,setsar=1,format=yuv420p -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -deadline good -cpu-used 1 out.webm`.
  `setsar=1` matters: some GIFs carry a pixel aspect byte that browsers ignore for GIFs but honour in video.
- `assets/img/resume.webp`: an image of the resume's first page (the PDF at 144 dpi, 1224×1584 for US Letter), shown instead of the PDF viewer on phones and in browsers without one. `update_resume` re-renders it.
- `update_resume`: replaces the resume with a new PDF and pushes it (see below); `update_resume.cmd` runs it from cmd or PowerShell
- `.github/workflows/resume-image.yml`: renders `resume.webp` on GitHub when a PDF is pushed without it
- `reactor/`: the Pixel Nuclear Reactor page (see below)

Any element with the class `rock` becomes a collider automatically.

## Pixel Nuclear Reactor

`reactor/` is a page of its own, linked from the featured card on the
Projects tab: a pixel-art cross section of a small modular reactor plant at
night, running on a real-time model of the whole plant. Pull the rods, trip
the pumps, cut the grid and watch the town's lights. It's sized like NuScale's
module (250 MW of heat, 77 MW of electricity, 138 bar) but laid out as a loop
like a classic PWR so every part shows.

- The reactor is point kinetics with six delayed-neutron groups. Reactivity
  comes from the rods, the boron, the fuel temperature (Doppler), the
  moderator temperature and voids, and the decay heat after a shutdown is six
  groups fitted to 6.4% of power.
- Heat flows from the fuel to the primary water, round the loop (core, hot
  leg, steam generator, cold leg, pump, with a pressurizer) and into the
  steam that drives the turbine. With the pump off, the water keeps moving by
  natural circulation.
- With no power at all, the passive cooling loop carries the decay heat into
  the pool around the containment. The pool takes about two days to reach
  boiling, then boils off slowly: about an eighth of it in a week.
- The protection system trips the reactor on high power (110%), a short
  period at low power, high or low primary pressure, a high hot-leg
  temperature, low flow, a low steam generator level or a turbine trip.
  Rods on automatic hold the coolant temperature as the grid's load changes.
- Six scenarios: full power, a cold start, a turbine trip, a pump failure, a
  station blackout and a sandbox with the protection off. Damaging the core
  there brings up a calm screen that names the trip that would have saved it.
- The simulation steps at a fixed 60 Hz and can run ×10 and ×60, or ×3600
  once the reactor is shut down and quiet, to watch a blackout over days.
- 18 achievements guide players round what the plant can do, from a first
  SCRAM and a cold start to natural circulation, each protection trip, a
  72-hour blackout and a meltdown in the sandbox. Each box at the bottom of
  the page says what to try, and Try it loads the scenario to start from.
  An unlock pops up a banner over the plant with pixel sparks and a fanfare,
  and its box fills with colour once it scrolls into view. Progress is kept
  in the visitor's browser (`localStorage`, key `reactor.achievements`).

Files:

- `reactor/index.html`: the page: the plant, the control desk (Reactor,
  Plant, Grid and Alarms tabs), trends and "How it works"
- `reactor/css/reactor.css`: its styles
- `reactor/js/sim.js`: the plant model and the protection system
- `reactor/js/scenarios.js`: the scenarios and their briefings
- `reactor/js/art.js`: the pixel art, all drawn in code (palette, parts,
  pipes and the static background) into a 480 × 270 buffer
- `reactor/js/render.js`: draws each frame from the model: coolant colours,
  rods, the core's glow, machines, steam, the plume and the town's lights
- `reactor/js/audio.js`: Geiger clicks, pump hum, turbine whine and the
  klaxon, synthesised with Web Audio
- `reactor/js/trend.js`: the trend charts
- `reactor/js/ui.js`: the control desk, readouts, alarms, event log,
  scenario picker, labels and inspect cards
- `reactor/js/achievements.js`: the achievements and the tracker that tests
  the plant against them each frame (no DOM)
- `reactor/js/achievements-ui.js`: the achievement boxes, the unlock banner
  and sparks, the counter in the top bar and the goal Try it sets
- `reactor/js/app.js`: the 60 Hz loop, speeds, pixel scaling and pointer input
- `reactor/test/`: tests for the model, the renderer and the achievements
  (each one is unlocked by driving the model), which need no browser:
  `node --test reactor/test/*.test.js`
- `reactor/tools/`: makes the Projects clip and the link preview picture
  (`reactor/share.png`)

The clip (a SCRAM at full power) is recorded from the simulation itself, at
2× in whole pixels:

    node reactor/tools/clip.js | ffmpeg -f rawvideo -pix_fmt rgba -s 480x270 -r 30 -i - -an -vf scale=960:540:flags=neighbor,setsar=1,format=yuv420p -c:v libx264 -preset veryslow -crf 28 -profile:v high -movflags +faststart assets/img/projects/pixel-reactor-1.mp4
    node reactor/tools/clip.js | ffmpeg -f rawvideo -pix_fmt rgba -s 480x270 -r 30 -i - -an -vf scale=960:540:flags=neighbor,setsar=1,format=yuv420p -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -deadline good -cpu-used 1 assets/img/projects/pixel-reactor-1.webm
    node reactor/tools/clip.js --poster | ffmpeg -f rawvideo -pix_fmt rgba -s 480x270 -i - -vf scale=960:540:flags=neighbor -c:v libwebp -lossless 1 -compression_level 6 assets/img/projects/pixel-reactor-1.webp

`node reactor/tools/share.js` redraws `reactor/share.png`; it needs Playwright.

## Updating the resume

From the root of the clone, in Git Bash or WSL (or any bash):

    ./update_resume path/to/updatedresume.pdf

From cmd use `update_resume path\to\updatedresume.pdf`, and from PowerShell
`.\update_resume path\to\updatedresume.pdf`. That runs `update_resume.cmd`,
which starts the same script with Git Bash, or with WSL if Git for Windows
isn't installed.

It pulls the latest `main`, copies the PDF to `assets/docs/Zafir_Maricar_Resume.pdf`,
renders the phone image of its first page to `assets/img/resume.webp` (144 dpi,
WebP quality 82), sets that image's `width`/`height` in `index.html`, bumps the `?v=` version
on the PDF and image links (so browsers and the Pages cache fetch the new files), commits
"Update the resume" and pushes. Pages publishes it a minute or two later. Add
`--no-push` to commit without pushing.

To render the image it uses the first of these it finds: `pdftoppm` (Poppler),
PyMuPDF, or ImageMagick with Ghostscript, then `cwebp`, ImageMagick or Pillow to
encode it. The easiest install on Windows is `py -m pip install pymupdf pillow`.
If none are installed it pushes only the PDF, and the "Resume image" GitHub
Action renders and commits the image a minute later, so pull before your next
change. The Action can also be run by hand from the Actions tab.

The script refuses to run off `main`, during a merge or rebase, or when the
resume files or `index.html` have uncommitted changes. If the push fails (for
example Git Bash isn't signed in to GitHub), the commit stays local and can be
pushed from GitHub Desktop.

Under WSL, on the Windows clone (`/mnt/c/...`), the script reads the repo the way
Windows git does (CRLF line endings, no executable bits), so files GitHub Desktop
checked out don't look modified, and it pushes through Windows' Git Credential
Manager when Git for Windows is installed.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. Opening `index.html` directly also works.
Safari only plays video from servers that answer byte-range requests, which
`http.server` doesn't, so to see the project clips in Safari use something
like `npx http-server -p 8000` instead. GitHub Pages handles ranges.
