# zafirmaricar.github.io

Personal portfolio of Zafir Maricar. Plain HTML, CSS and JavaScript with no build step.

Rain falls over the page as a real-time 2D particle fluid. Every content panel
is drawn as a rock and acts as a collider, so water pools on top of the panels
and runs off their edges. Move the cursor through the water to push it, and
click empty space to splash.

Rocks can be broken. Clicking a rock cracks it open at that spot, and a second hit
on the same spot breaks that chunk off. The chunk carries the
text it covered, falls as a rigid body, bounces off the rocks below and pushes
the water aside until it drops off the page. "Repair rocks" restores everything.

Rubber ducks ride the rain: while there are fewer than three on the page, a
new one drops in every 7 seconds. Each duck is a light rigid body. Probes
round its hull feel the nearby water, lifting it where the water is deep
enough and dragging it along with the flow, so ducks float where water pools
on the rocks and get carried off by the streams. They bounce off rocks and
falling chunks, the water flows around them, and clicking one makes it hop.

The Projects tab shows each project's images and clips from the old Google
Site. The GIFs are converted to short looping videos (H.264 MP4 with a VP9
WebM fallback), which load and play only while on screen. Projects with
several items get a small gallery like the old site's carousels. Media can be
cracked and broken off like the rest of the rock; the cracks are drawn over it
too.

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
- `js/media.js`: project media: clips that play only on screen, gallery thumbnails, and the YouTube poster that loads the player when tapped
- `js/main.js`: tabs, rain, pointer input and the 60 fps main loop
- `assets/docs/Zafir_Maricar_Resume.pdf`: the resume shown on the Resume tab, exported from the resume's Google Doc
- `assets/img/projects/`: project media. Each clip is `<name>.mp4` + `<name>.webm` with a `<name>.webp` poster (its first frame); stills are `<name>.webp` (at most 960 px wide); gallery thumbnails are `<name>-thumb.webp` (92 px tall, taken 40% into a clip). Clips were made from the GIFs with
  `ffmpeg -i in.gif -an -vf scale=W:-2:flags=lanczos,setsar=1,format=yuv420p -c:v libx264 -preset veryslow -crf 26 -profile:v high -movflags +faststart out.mp4`
  and the WebM with
  `ffmpeg -i in.gif -an -vf scale=W:-2:flags=lanczos,setsar=1,format=yuv420p -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -deadline good -cpu-used 1 out.webm`.
  `setsar=1` matters: some GIFs carry a pixel aspect byte that browsers ignore for GIFs but honour in video.
- `assets/img/resume.webp`: an image of the resume's first page (the PDF at 144 dpi, 1224×1584 for US Letter), shown instead of the PDF viewer on phones and in browsers without one. `update_resume` re-renders it.
- `update_resume`: replaces the resume with a new PDF and pushes it (see below)
- `.github/workflows/resume-image.yml`: renders `resume.webp` on GitHub when a PDF is pushed without it

Any element with the class `rock` becomes a collider automatically.

## Updating the resume

From the root of the clone, in Git Bash (or any bash):

    ./update_resume path/to/updatedresume.pdf

It pulls the latest `main`, copies the PDF to `assets/docs/Zafir_Maricar_Resume.pdf`,
renders the phone image of its first page to `assets/img/resume.webp` (144 dpi,
WebP quality 82), sets that image's `width`/`height` in `index.html`, commits
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

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. Opening `index.html` directly also works.
Safari only plays video from servers that answer byte-range requests, which
`http.server` doesn't, so to see the project clips in Safari use something
like `npx http-server -p 8000` instead. GitHub Pages handles ranges.
