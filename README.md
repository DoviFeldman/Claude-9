# OpenCanvas

A free, open-source design editor in the spirit of Canva — no accounts, no server, no tracking.
Open the page and start designing. Everything you make stays in **your browser**.

![OpenCanvas](https://img.shields.io/badge/built%20with-React%20%2B%20Fabric.js-8b3dff)

## Features

**Canvas**
- Any canvas size in **px, inches, cm or mm**, resizable at any time
- Templates for popular formats: YouTube thumbnail, Instagram post/story, Facebook, X/Twitter,
  LinkedIn banner, Pinterest, presentations, website mockups, A4 / US Letter, business card, poster, flyer, logo
- Multiple **pages stacked vertically** (add, duplicate, reorder, delete)
- **Drag elements between pages** — drop a selection onto another page and it moves there;
  elements dropped into empty space are pulled back so nothing is ever lost off-canvas
- Smart zoom (Ctrl+scroll, slider, fit-to-screen) and panning (Space+drag or middle mouse)
- **Extensive snapping**: page edges & center plus the edges and centers of every other
  element on the page, with live guide lines (hold Ctrl while dragging to disable);
  rotation snaps gently at 15° steps
- **Mobile friendly** — on phones the tool rail docks to the bottom, panels open as bottom
  sheets, and the canvas supports pinch-to-zoom and touch dragging
- **Optional PWA**: installable from the browser menu (no install prompts, ever) with quiet
  offline support

**Elements**
- Shapes: squares, rectangles, circles, ovals, triangles — with **corner rounding**,
  borders (solid/dashed), fill color, transparency, rotation, flipping
- Lines: solid, dashed, dotted, any thickness and color
- **Freehand drawing** with adjustable pen size, color and transparency; strokes become
  regular objects you can select, move, recolor and delete
- Text: heading/subheading/body presets, 40+ popular fonts (Google Fonts + system),
  bold/italic/underline/strikethrough, alignment, **letter spacing, line spacing,
  shadow, text background**, color and transparency
- **Add any Google Font by name** (from the font menu or the Text panel) and
  **upload your own font files** (.ttf/.otf/.woff/.woff2) — custom fonts persist in your
  browser and travel inside saved project files

**Uploads & editing**
- Drag & drop (or paste, or upload) **images, SVG, PDF, PPTX and HTML** files
- An **uploads folder** keeps your files in the browser so you can reuse them without re-uploading
- **Crop images** permanently with an intuitive crop overlay (works on rotated images too)
- **Replace colors in images**: pick a color straight from the photo, choose a new one,
  set the tolerance, done — pixels are edited permanently (undo still works)
- One-click link to [remove.bg](https://www.remove.bg) for background removal
- **PDF editing**: import as *editable text* (rewrite, restyle, move every line) or as an
  *exact copy* (each page becomes a high-quality image you can design over, crop, or cover)
- Basic PPTX import (text and images with positions) and HTML import (images + text become objects)

**Color**
- Full color picker (saturation/value area + hue + hex input + native eyedropper where supported)
- **Gradients everywhere**: linear & radial gradient fills for shapes and text, gradient page
  backgrounds, a preset gallery, any number of color stops with per-stop position and opacity —
  including **transparency gradients** (e.g. orange fading into soft clear)
- **Suggested palettes extracted from your uploaded images**, document colors, and default swatches

**Organize**
- Group / ungroup, layer controls (forward, backward, to front, to back)
- Align to page (left/center/right/top/middle/bottom), lock, duplicate
- Undo/redo, autosave, full keyboard shortcuts

**Projects — save, reopen, share**
- **Save the whole design as a `.opencanvas` project file** (Save button or Ctrl+S): a zip
  holding the canvas size, every page, each element's exact position/size/rotation, applied
  crops and color edits, all images used, and your custom fonts
- **Open** it later (Open button, Ctrl+O, or drop the file onto the canvas) to continue exactly
  where you left off — or send the file to someone else so they can edit the design themselves

**Download** (top-right button, defaults to JPG, remembers your choice)
- **JPG, PNG (optionally transparent), PDF, SVG, HTML** at 1×/2×/3×
- All pages, the current page, or **just the selected element(s) / group**
- Multi-page raster/SVG exports arrive as a zip; PDF is a single multi-page file
- **HTML export** rasterizes graphics into a background JPG per page and keeps top-level
  text as real, selectable HTML text

## Privacy & storage

There are no accounts and no backend. Designs autosave to your browser's IndexedDB and
your uploads live there too. Anything not used for **7 days** is cleaned up automatically
(visiting the page keeps your design alive). Closing the tab loses nothing; clearing the
browser's site data removes everything.

## Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev        # development server at http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build locally
```

## Deploy to Vercel (recommended)

1. Fork or push this repository to your GitHub account.
2. Go to [vercel.com/new](https://vercel.com/new) and **import the repository**.
3. Vercel auto-detects Vite. Confirm the defaults:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
4. Click **Deploy**. That's it — no environment variables, no database, no config.

Or from the terminal:

```bash
npm i -g vercel
vercel --prod
```

## Self-host anywhere

OpenCanvas builds to plain static files, so any static host works
(Netlify, GitHub Pages, Cloudflare Pages, nginx, S3…):

```bash
npm install
npm run build
# now serve the dist/ folder with any web server, e.g.:
npx serve dist
```

No server-side code runs anywhere — user data never leaves the visitor's browser.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + S` / `Ctrl/Cmd + O` | Save / open a project file |
| `Ctrl/Cmd + Z` / `Ctrl/Cmd + Y` | Undo / redo |
| `Ctrl/Cmd + C` / `X` / `V` | Copy / cut / paste elements (paste also imports images from your clipboard) |
| `Ctrl/Cmd + D` | Duplicate |
| `Ctrl/Cmd + G` | Group selection |
| `Ctrl/Cmd + A` | Select all on the page |
| `Delete` / `Backspace` | Delete selection |
| Arrow keys (`+ Shift`) | Nudge by 1px (10px) |
| `Ctrl/Cmd + scroll` | Zoom at cursor (pinch to zoom on touch screens) |
| `Ctrl` while dragging an element | Temporarily disable snapping |
| `Space + drag` / middle mouse | Pan |
| `Esc` | Deselect / exit draw or crop mode |
| Double-click text | Edit text |

## Tech stack

- [React 18](https://react.dev) + [Vite](https://vitejs.dev) + TypeScript
- [Fabric.js 6](http://fabricjs.com) — canvas object model, selection, transforms, serialization
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF import (text extraction & rendering)
- [jsPDF](https://github.com/parallax/jsPDF) — PDF export
- [JSZip](https://stuk.github.io/jszip/) — PPTX import and zipped multi-page downloads
- IndexedDB for autosave and the uploads folder — no backend at all

## Notes & limits

- Text inside groups is rasterized (not kept as live text) in HTML exports; ungroup text
  you want to stay selectable.
- PPTX import is intentionally basic: text boxes and images with positions. Complex themes,
  charts and WMF/EMF media are skipped.
- PDF "editable text" mode imports text only (graphics are not carried over) — use
  "exact copy" mode when the layout matters.
- Remote images referenced by imported HTML files are fetched only if their server allows
  it (CORS); otherwise they're skipped with a notice.

## License

MIT — see [LICENSE](LICENSE).
