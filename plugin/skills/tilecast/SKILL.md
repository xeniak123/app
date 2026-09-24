---
name: tilecast
description: Design posters, flyers, announcements, social posts, banners and short promo or launch videos from scratch as HTML/CSS pages, then check and render them with the Tilecast MCP tools (preview, check, render_image, render_video, assets). Use when someone asks for a poster, plakat, flyer, ogłoszenie, social media graphic, story, banner, thumbnail, promo video, launch video or reel, says "brag about this project", or wants to announce an event, a sale, an opening or a release.
---

# Tilecast

You are the designer and the motion designer. There are no templates: every piece is a small web page you compose from scratch for this one message, the way a top studio would. Tilecast renders it pixel-exact in headless Chrome, critiques it, and exports print PDFs, PNGs and MP4s.

Why a web page: HTML and CSS give you real typography, grids, gradients, masks, blend modes, SVG and animation, and you already write them fluently. Why not templates: a template makes every poster look like the last one. The work is to find the one idea that fits this message and build exactly that.

## Parse the request

Read the whole request first. Options can come as flags or plain language:

| Option | Values | Default |
|---|---|---|
| what | poster, flyer, announcement, social post, story, banner, video | inferred |
| `--format` | `poster-a4`, `poster-a3`, `flyer-a5`, `square`, `portrait`, `story`, `landscape`, `og`, or `WIDTHxHEIGHT` | print: `poster-a4`; social: `square` + `story`; video: `landscape` (`story` for Reels, TikTok, Shorts) |
| `--tone` | `default`, `polished`, `yc-parody`, `chaotic`, `deadpan`, `cinematic`, `app-store`, or freeform ("fake Series A launch from 2016") | inferred |
| `--duration` | seconds (video) | about 20 (15–25) |
| `--no-music`, `--no-sfx` | flags (video) | music and effects on |
| language | the user's language | the language the user writes in |

A freeform tone maps to the nearest preset for pacing and structure, but keep the user's words in the plan.

## Output folder

Each piece lives in its own folder: `tilecast/<slug>/` with `<slug>.html`, its assets (`assets/`, `audio/`), `plan.md`, and `export/` for renders. If the folder exists and the user asked for something new, use `tilecast/<slug>-YYYY-MM-DD-HHmmss/`. Never write outside the project.

## Step 1: Inspect

Gather the material. Only the source changes; the questions after the table are the same for every input.

| Input | Where the material comes from |
|---|---|
| A brief ("jazz concert Saturday 7 pm in the park, free entry") | The user's words. Everything the piece states must come from them. |
| The current project ("make a launch video", "/brag this") | The code: main page, styles (exact colors, fonts), README, routes, key components. Find the product **in use**: entry → key action → result. |
| A website URL | The site as a visitor sees it: copy, colors, fonts, logo, screenshots of its real UI. Save what you use into the piece's folder. |
| Files (photos, logo, menu, price list) | Read them, copy what you use into the piece's folder. |

Then answer, in a few words each:

1. What is it, in one sentence?
2. Who is it for, and what should they do after seeing it (come, buy, sign up, share)?
3. The one thing a stranger must remember.
4. The facts: date, time, place, price, link, contact. **Only the ones you were given.** Never invent a price, date, address, phone number, URL, testimonial or statistic. If a fact the piece needs is missing, leave it out or ask.
5. The real material to show: product UI, photos, logo, brand colors and fonts.
6. The hook: the single image, word or motion that stops the scroll.
7. The tone.
8. The formats, and for video the duration.
9. The one-line caption someone would post with it.

**Gate:** you can answer all nine.

## Step 2: Plan

Write `tilecast/<slug>/plan.md`, one page:

- **Concept:** the idea in one line. "The date is so big it becomes the poster." "The app's own chat bubble tells the story." Not "a modern, clean poster".
- **Hierarchy:** what is read first, second, third. At most three levels.
- **Layout:** a quick sketch in words for each format (what goes where, what is huge).
- **Palette:** 2–4 colors with hex values, from the brand when there is one.
- **Type:** a display family and a text family from the bundled fonts (`assets` `list_fonts`), with the weights.
- **Imagery:** what the picture is: the real product, the user's photo, or something you draw in CSS and SVG. See [references/design.md](references/design.md).

For a video, also:

- **Storyboard:** scenes with start times, durations, the exact on-screen text, the motion, and the transition into the next scene. Shape: Hook (2–3 s) → Reveal (2–4 s) → 2–3 highlights → Payoff with logo and call to action (2–4 s). Durations sum to the target.
- **Reading budget:** every line people must read gets about 0.3 s per word fully visible and still (0.8 s minimum; the hook more). If a scene has more text than its length allows, cut the text or split the scene; never speed it up.
- **Audio:** music style and where its strong cues land (the drop on the reveal, the final hit on the logo), and the few effects that mark cuts and big entrances. See [references/audio.md](references/audio.md).

**Gate:** `plan.md` exists. For a video, the scene durations add up to the target and every line fits its reading budget.

## Step 3: Compose

**Read:** [references/design.md](references/design.md) every time; [references/motion.md](references/motion.md) for any video or animated piece; [references/runtime.md](references/runtime.md) for the composition contract; [references/tones.md](references/tones.md) for the chosen tone.

Write `tilecast/<slug>/<slug>.html` from scratch: one self-contained page, the canvas is the viewport, sizes relative to the canvas so the same file serves every format you planned. The plan is the contract: if a better idea comes up while composing, update `plan.md` so the concept and the page still agree. Put `<meta name="tilecast:formats" content="…">` in it; for a video also `tilecast:duration`, `tilecast:scenes` and, once you know it, `tilecast:poster`.

For video audio: `assets` `make_music` with the planned style and duration, or the user's own track analyzed with `analyze_music`; then retime the big moments to the strong cues; add effects with `make_sfx` or `add_sfx`.

## Step 4: Look and check

1. `preview` the composition. Look at the image properly: for a static piece every format side by side, for a video a filmstrip with every scene settled and every cut mid-transition.
2. Judge it like an art director:
   - **Squint test:** blur your eyes. Is the headline the first thing, and does the page have one clear shape?
   - **Three-second test:** could a stranger say what, when and where after three seconds?
   - Is everything aligned to something? Are the margins generous and equal? Does any format look cramped or empty?
   - Would a top studio post this? If it looks like "an AI made this", find out why (see the anti-patterns in design.md) and fix it.
3. `check`: the design critic. It measures text off the canvas or cut off, collisions, tiny text, contrast on the real pixels, missing fonts and images, and for video the reading time of every line across the whole timeline, flashes, an empty opening or ending, and missing audio.
4. Fix and repeat until `check` reports no ✗ and the preview looks like something you would sign. Treat warnings as design feedback: fix them unless you can say why the design wants it that way.

**Gate:** `check` passes with zero errors, and you have looked at every format (and for video, every scene and every cut).

## Step 5: Render and deliver

- **Images:** `render_image`. Print formats come out at 300 dpi as PNG plus a PDF of the exact paper size; social formats at their native size.
- **Video:** `render_video` renders the final MP4 at 30 fps with the music and effects mixed. The best settled frame becomes frame 0 and is also saved as `.jpg`, so every platform's thumbnail shows it: set `tilecast:poster` to your strongest settled moment (the hook line, the reveal, or the final logo), or let Tilecast pick the moment with the most settled large type. `quality: "draft"` renders a quick half-size version first when the user wants to see motion before the final.
- **Share copy:** write `tilecast/<slug>/share-copy.txt`: 1–3 sentences, postable as-is, specific, in the tone. No "excited to share".
- **Tell the user** where the files are, the idea in one sentence, and offer one next step: another tone, another format, or re-rolling a scene or the music.

## Laws

These apply to every piece, whatever the tone.

- **One idea.** Every piece has one concept, one focal point and one thing to remember.
- **Specific.** It must feel made for this exact message: the user's own words, facts, product and colors. Generic lines ("elevate your experience", "streamline your workflow") are banned.
- **Show the thing.** Use the real product UI, the real photo, the real menu. Reuse the project's components, CSS and assets instead of drawing a lookalike. Never abstract filler.
- **Hierarchy you can see from across the room.** Headline huge, facts clear, details quiet. Three sizes, not seven.
- **Readable.** Contrast on the real pixels, nothing cut off, nothing too small for the format. In video, pace comes from motion and cuts, never from pulling text away early: fast in, then hold.
- **The hook is everything.** On a poster, the thing you see first from a distance; in a video, the first two seconds.
- **Short.** Posters say less than you think. Videos run 15–25 seconds; 18–22 is the sweet spot.
- **Every frame postable.** Any still of a video, and any format of a poster, is worth sharing on its own.
- **Honest.** Only facts you were given. Humor comes from the subject, not from trying.

## Tones

| Tone | Feel | Posters | Video pacing and cuts | Music |
|---|---|---|---|---|
| `default` | Playful, clean, postable | Bold type, one bright accent | 4–5 scenes, snappy moves, soft transitions | `upbeat` |
| `polished` | Serious, elegant, restrained | Editorial serif, air, fine rules | 3–4 scenes, long holds, soft fades | `chill` |
| `yc-parody` | Deadpan startup launch, played straight | Keynote minimal, one huge claim | 4–5 scenes, one claim each, hard cuts | `minimal` or `upbeat` |
| `chaotic` | FAST, LOUD, ALL CAPS | Clashing colors, giant type, stickers | 6–8 scenes, some under 2 s, zoom and flash cuts | `driving` |
| `deadpan` | Calm, dry, nothing is a joke | Vast empty space, small type | 3–4 scenes, one word at a time, slow fades | `minimal` |
| `cinematic` | Trailer-scale, epic claims | Dark, dramatic light, huge title | 4–5 scenes, big type, dramatic wipes | `cinematic` |
| `app-store` | Clean feature cards | Product front and center, soft shadows | 4–6 scenes, smooth slides | `upbeat` or `chill` |

Full definitions: [references/tones.md](references/tones.md).

## Credits

The video workflow, the creative laws and the tone presets are adapted from [/brag](https://github.com/latent-spaces/brag) by Shunit Haviv Hakimi (MIT license). The recorded sound effects are by [Kenney](https://kenney.nl) (CC0).
