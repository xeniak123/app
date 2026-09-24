# Design: posters, announcements and social graphics

How to compose a still that looks like a studio made it. Everything here is a way of thinking, not a layout to copy: pick what serves this message's one idea.

## The canvas

- The viewport **is** the canvas. `poster-a4` is 1240×1754 CSS px (exported at 2× = 300 dpi), `square` 1080×1080, `portrait` 1080×1350, `story` 1080×1920, `landscape` 1920×1080, `og` 1200×630.
- Size everything relative to the canvas so one file works in every format: `vmin` for type and spacing, `vw`/`vh`/`%` for placement, `clamp()` to keep extremes sane. `html, body { margin: 0; width: 100%; height: 100%; overflow: hidden }`.
- Switch layouts per shape with media queries: `@media (aspect-ratio > 1.2)` for landscape and banners, `@media (aspect-ratio < 0.62)` for stories. A story is not a shrunk poster: re-stack it.
- **Safe margins:** at least 6% of the shorter side on every edge (≈ 65 px on a 1080 square). Print: keep text 5 mm (≈ 60 px on A4) from the trim. Stories: keep text out of the top 12% and the bottom 18%, where the app's own UI sits.
- A spacing scale beats ad hoc numbers: `--u: 1vmin`, then use 2u, 3u, 5u, 8u, 13u.

## Composition

Decide what is **huge**. A poster read from across a street has one dominant element that takes 30–60% of the canvas: the headline, the number, the date, the product, the photo. Everything else is small and organised around it.

Archetypes to think with (combine and break them; never fill them in like a form):

- **Type as image.** The headline set so big it is the picture: cropped at the edges, stacked word per line, one word in italic or in the accent color.
- **The number.** "-40%", "12.10", "49 zł", "3×" as the hero; the rest is a caption to it.
- **Image dominant.** A real photo or product shot fills 60–100% of the canvas; type sits on a calm area or on a solid band, never on a busy part.
- **Split.** Two fields: color and image, or two colors, meeting on a straight or diagonal edge. Strong for before/after and comparisons.
- **Swiss grid.** A visible grid of 4–12 columns, flush-left type, hairline rules, numbers like "01" and "02". Serious, informative, great for programs and schedules.
- **Frame.** A border or inset panel with generous margin; calm, premium, invitation-like.
- **Diagonal energy.** Rotated type or bands (-8° to -15°), for sport, sales and chaos.
- **Object and orbit.** One central object (logo, product, icon drawn huge) with small type placed around it.

Use CSS grid with named areas for structure, `position: absolute` for deliberate overlaps, and asymmetry: a left-aligned column with a big empty right side reads as confident; everything centered reads as a greeting card.

## Hierarchy

- Three levels, not more: **headline** (10–24 vmin), **key facts** (3.5–6 vmin), **details** (2.2–3 vmin). Neighbouring levels differ by at least 2.5× in size or by weight and color.
- The reading path follows the story: what → when/where → how (call to action). On social formats the call to action is short and concrete ("Bilety: jazzwparku.pl", "Pierwsza kawa gratis do 12:00"), only with facts you were given.
- Group related facts tightly; separate groups with space, not with boxes.

## Typography

- Pair a display face with a text face from the bundled families (`assets` `list_fonts`), or use one family in two weights. Good pairs: Bricolage Grotesque + Inter, Fraunces + Inter, Instrument Serif + Instrument Sans, Anton + Space Mono, Unbounded + Manrope, Playfair Display + Manrope, Archivo Black + Archivo, Syne + Space Grotesk.
- Display type: heavy weight (700–900 for variable families), line-height 0.85–0.95, letter-spacing -0.02em to -0.05em at large sizes. Condensed faces (Anton, Bebas Neue, Oswald) stack words into tall blocks.
- Labels and small caps: uppercase, letter-spacing 0.08–0.14em, 600 weight.
- `text-wrap: balance` for headlines, `text-wrap: pretty` for sentences; break headlines by meaning with `<br>`, not by accident. No single orphan word on the last line of a headline.
- Numbers: `font-variant-numeric: tabular-nums` in lists and schedules; lining figures in big numbers.
- Italic or a second color for the one word that carries the emotion ("Jazz *w parku*"), not for decoration.
- Polish and other accented text: every bundled family covers Latin Extended (except Permanent Marker, Latin only). The critic flags missing glyph fonts.
- Tight leading and accented capitals don't mix: at line-height below 1, the accents of Ż, Ź, Ś, Ć, Ń, Ó (and É, Ü…) run into the line above and can vanish behind it. Give lines with accented capitals at least 1.0–1.1, and look at them in the preview.
- Optical alignment: very large type needs a small negative left margin (about -0.04em) to line up with smaller text below it.

## Color

- 60/30/10: one dominant field, one secondary, one accent for the single most important thing. Tinted neutrals (#14110f, #f4efe6) look richer than pure black and white.
- Use the brand's exact colors when there are any; build the rest from them (a darker shade for text, a light tint for the background).
- Contrast: body text 4.5:1, large text 3:1 against what is really behind it. The critic measures this on the rendered pixels, including photos and gradients.
- Palettes that work (start here, then adjust to the message):
  - Tomato on cream: `#f4efe6` `#e8452c` `#1d1a17`
  - Ink and acid: `#101014` `#d4ff3a` `#f2f2f2`
  - Night jazz: `#0f1a2b` `#ffb347` `#ff5e3a` `#f4efe6`
  - Forest and sand: `#1f3a2e` `#e9dcc3` `#c8743a`
  - Riso pink and blue: `#f7f1e8` `#ff4f9a` `#2b59ff` (overlap with `mix-blend-mode: multiply`)
  - Clinical: `#ffffff` `#0b5cff` `#0d1321` `#e8eef9`
  - Candy: `#ffe45e` `#ff6ba6` `#7b2ff7` `#1b1b1b`
  - Dark luxury: `#0e0d0b` `#c9a86a` `#efe8dc`
  - Brutalist: `#e9e9e4` `#111111` plus one of `#ff3b00` / `#0038ff`
  - Pastel calm: `#eef3ee` `#b8d8c8` `#2f4b3f` `#f2b8a2`

## Imagery without stock photos

Use the real thing first: the user's photos, the product UI (rebuild it with the project's real components and CSS, or screenshots of it), the logo. Otherwise draw, with the browser's full toolbox:

- **Big shapes:** circles, arcs, pills and blobs (`border-radius`), cropped by the canvas edge so they feel large.
- **Gradients:** layered `radial-gradient`s make mesh gradients; `conic-gradient` for sunbursts; add grain so they don't look plastic.
- **Grain:** an SVG `feTurbulence` noise as a data URL in a full-canvas overlay at 5–10% opacity with `mix-blend-mode: overlay` or `multiply`.
- **Halftone and patterns:** `radial-gradient` dot grids, `repeating-linear-gradient` stripes, checkerboards.
- **Duotone photos:** `filter: grayscale(1) contrast(1.1)` plus a colored layer with `mix-blend-mode: multiply` or `screen`.
- **Type as texture:** a word repeated in outline (`-webkit-text-stroke`) behind the headline; text filled with an image or gradient (`background-clip: text`). Mark decorative text `aria-hidden="true"` so the critic doesn't judge it as copy.
- **Icons as illustration:** a Lucide icon (`assets` `find_icons`, `get_icons`) drawn huge with a thin stroke (1–1.5) reads as a graphic, not as clip art. Never icons in little colored circles.
- **Product mockups:** a phone or browser frame drawn in CSS around the real UI, with a soft layered shadow.

Put a scrim (a gradient from transparent to the background color) under text on photos, or put the text on a solid band.

## Details that read as professional

- Hairline rules (1–2 px) and small labels ("NO. 03", "SOBOTA", "WSTĘP WOLNY") organise information.
- A rotated sticker or badge (-8° to -12°) for an offer or a price, used once.
- Consistent corner radii (all sharp, or all the same radius).
- Layered shadows for depth: `0 1px 2px rgba(0,0,0,.08), 0 12px 40px rgba(0,0,0,.18)`; never a heavy black drop shadow on text.
- Real content only. No lorem ipsum, no "Your Company", no placeholder faces.

## Print

- A4 and A3 posters and A5 flyers export as 300 dpi PNG plus a PDF of the exact paper size. There is no bleed: if a print shop needs 3 mm bleed, extend backgrounds past the canvas edge in the design and tell the user.
- Dark, full-bleed backgrounds print beautifully but use a lot of ink; mention it for home printing.

## Anti-patterns: the "an AI made this" tells

- Purple-to-blue gradients on everything, glassmorphism cards, neon glow on dark.
- Everything centered, with an emoji on top.
- Icons in colored circles, generic 3D blobs, stock-looking illustrations.
- Five font sizes and three fonts; all text the same weight.
- Drop shadows or outlines on text to rescue contrast.
- Text on a busy photo without a scrim.
- Tiny text crammed in the corners; margins that differ on each side.
- Invented facts, fake testimonials, "Lorem", "Company Name".
- The headline is a slogan that fits any business.

## Before you run check

- Squint: the headline is the first thing and the page has one clear shape.
- Three seconds: what, when, where and what to do are clear.
- Every element aligns with something; margins are generous and equal.
- Every format is composed, not shrunk: look at each one in `preview`.
