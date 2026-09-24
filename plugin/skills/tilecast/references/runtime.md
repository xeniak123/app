# Runtime: the composition contract

A composition is one `.html` file inside the project. Tilecast opens it in headless Chrome at the format's size, controls its clock, and captures it. Anything a browser can draw works: CSS, SVG, canvas, images, video, web fonts in the project.

## Skeleton: a poster

```html
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="tilecast:formats" content="poster-a4 square story">
<title>Jazz w parku</title>
<style>
  :root { --bg: #0f1a2b; --ink: #f4efe6; --accent: #ffb347; --u: 1vmin; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body { background: var(--bg); color: var(--ink); font-family: 'Inter', sans-serif; position: relative; }
  h1 { font: 800 calc(15 * var(--u)) / .9 'Fraunces', serif; letter-spacing: -0.03em; margin: 0; }
  /* layouts per shape */
  @media (aspect-ratio > 1.2) { /* landscape, banners */ }
  @media (aspect-ratio < 0.62) { /* stories */ }
</style>
</head>
<body>
  <h1>Jazz<br><em>w parku</em></h1>
</body>
</html>
```

## Skeleton: a video

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="tilecast:formats" content="landscape">
<meta name="tilecast:duration" content="18">
<meta name="tilecast:scenes" content="0 2.03 6.1 10.17 16.27">
<meta name="tilecast:poster" content="16.9">
<style>
  /* 0 hook · 2.03 reveal (drop) · 6.1 feature · 10.17 feature (return) · 16.27 logo (final hit) */
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0d0d10; color: #fff; }
  .scene { position: absolute; inset: 0; opacity: 0; }
  #s1 { opacity: 1; animation: out .3s 1.75s forwards; } /* the first scene is on screen from frame 0 */
  #s2 { animation: in .3s 2.03s both, out .3s 5.8s forwards; }
  /* … */
  @keyframes in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes out { from { opacity: 1 } to { opacity: 0 } }
</style>
</head>
<body>
  <section class="scene" id="s1">…</section>
  <section class="scene" id="s2">…</section>
  <audio data-tilecast src="audio/music-upbeat.wav" data-start="0" data-volume="0.8"></audio>
  <audio data-tilecast src="audio/impact.wav" data-start="16.27" data-volume="0.5"></audio>
  <script>
    tilecast.onFrame((t) => { /* computed motion, from t only */ });
  </script>
</body>
</html>
```

## Meta tags

| Tag | Meaning |
|---|---|
| `tilecast:formats` | Default formats, space separated: `poster-a4 poster-a3 flyer-a5 square portrait story landscape og` or `WIDTHxHEIGHT` |
| `tilecast:duration` | Makes it a video: length in seconds |
| `tilecast:fps` | Frames per second (default 30) |
| `tilecast:scenes` | Scene start times; previews and checks show each scene settled and each cut |
| `tilecast:poster` | The moment used for frame 0, the thumbnail and still renders |

Stills of a piece without `tilecast:poster` are taken when its entrance animations have finished (for videos, at 60% of the duration).

## Time

Time is virtual: the renderer sets it for every frame, and every frame must be a pure function of it.

- **CSS animations and transitions** are positioned exactly at each frame's time. Schedule with absolute delays from the start (`animation: rise .6s ease 6.15s both`). Infinite animations are fine.
- **Web Animations** (`element.animate()`), created at load with a `delay`, behave the same.
- **`requestAnimationFrame`**, `setTimeout`, `setInterval`, `Date` and `performance.now()` follow the render clock. Timers fire in order as time passes, but the renderer can jump straight to a late frame, so prefer declared animations and `onFrame` over chains of timers.
- **`tilecast.onFrame((t) => …)`** runs on every frame with `t` in seconds, after CSS is positioned; it may be async. Compute everything from `t`, never incrementally ("add 1 each frame" breaks when frames are skipped or rendered in parallel).
- Helpers: `tilecast.time` (seconds), `tilecast.progress(start, duration, easing)` (eased 0..1), `tilecast.tween(start, duration, from, to, easing)`, `tilecast.ease` (`linear`, `in`, `out`, `inOut`, `outQuart`, `outExpo`, `inExpo`, `inOutExpo`, `outBack`, `spring`), `tilecast.random(seed)` (a seeded generator; `Math.random()` differs per frame and makes things flicker).

## Fonts

Bundled families work by name, offline, with Latin Extended accents: Inter, Bricolage Grotesque, Fraunces, Unbounded, Syne, Archivo, Space Grotesk, Manrope, Instrument Sans, Playfair Display, Oswald, JetBrains Mono, Fredoka, Caveat (variable, any weight in range), and Anton, Bebas Neue, Archivo Black, Instrument Serif, DM Serif Display, Space Mono, Permanent Marker (static). `assets` `list_fonts` lists weights and italics.

Any other font needs a file in the project and an `@font-face` rule. Never link Google Fonts or other CDNs: renders must not depend on the network.

## Images, video, icons

- Local files by relative path: `<img src="assets/photo.jpg">`, `background-image: url(assets/texture.png)`, inline `<svg>`. Remote URLs are flagged by `check`; download what you need into the piece's folder.
- `<video src="assets/demo.mp4" muted>` follows the timeline: frame t of the composition shows the video at `t - data-start` (times `data-rate`); `loop` repeats it. Its sound is not included; add it as `<audio data-tilecast>` if needed.
- Icons: `assets` `find_icons` then `get_icons` return Lucide SVG that follows CSS `color`.

## Audio

`<audio data-tilecast src="…">` elements are mixed into the video: `data-start`, `data-volume`, `data-fade-in`, `data-fade-out`, `data-trim`, `data-duration`, `loop`. They never play in the page itself. Files must be local. See audio.md.

## Formats and responsive layout

- Design in CSS pixels at the format size; the export scales it (A4: 1240×1754 → 2480×3508).
- One file can serve several formats: size with `vmin`/`vw`/`vh`/`%` and switch layouts with `@media (aspect-ratio …)` or `@media (orientation: portrait)`.
- A custom size is `WIDTHxHEIGHT` in `formats`, e.g. `1500x500` for an X header.

## Pitfalls

- A scene container with `animation-fill-mode: both` on keyframes that end visible stays on screen forever; hide it again with a later `out` animation (see motion.md).
- Text hidden under another opaque layer is treated as not visible by the critic; a transparent overlay (`opacity: 0`) does not hide anything.
- `transition`s that start from a class added at load run from time 0; to schedule them, use animations with delays instead.
- Don't rely on scrolling, hover, `:focus` or user input; there is none.
- Don't use `Math.random()` or wall-clock time; use `tilecast.random(seed)` and `tilecast.time`.
- Keep everything inside the canvas unless it is meant to bleed off the edge (decoration). Text that runs off is an error.
