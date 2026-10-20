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
- `js/main.js`: tabs, rain, pointer input and the 60 fps main loop
- `assets/docs/Zafir_Maricar_Resume.pdf`: the resume shown on the Resume tab, exported from the resume's Google Doc
- `assets/img/resume.webp`: an image of the resume page (1224×1584, the PDF at 144 dpi), shown instead of the PDF viewer on phones and in browsers without one. Re-render it when the PDF changes.

Any element with the class `rock` becomes a collider automatically.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. Opening `index.html` directly also works.
