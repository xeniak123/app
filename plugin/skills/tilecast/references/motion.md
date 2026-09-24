# Motion: promo, launch and announcement videos

A Tilecast video is a web page whose every frame is a function of time. You write the scenes in HTML and CSS, schedule them with absolute times, and Tilecast captures 30 frames per second and mixes the sound. This file is how to make that feel like a real launch video: fast, readable, alive.

## Structure

```
Hook (2–3 s) → Reveal (2–4 s) → 2–3 sharp highlights (3–5 s each) → Payoff and call to action (2–4 s)
```

- **Hook:** the first frame already has something on it (never a blank fade-in). A huge word slamming in, the product mid-action, a bold question, a number counting. It decides whether anyone keeps watching.
- **Reveal:** what it is, by name, landing on the music's drop.
- **Highlights:** the product in use (entry → key action → result) or the two or three facts that matter. One idea per scene.
- **Payoff:** logo or name, the one-line promise and the call to action (URL, date, place), held still for at least 2 seconds, landing on the music's final hit.
- 15–25 seconds total; 18–22 is the sweet spot. Count the scene durations.

## Reading time

Pace comes from motion and cuts, never from pulling text away early.

- A line people must read stays fully visible **and still** for about 0.3 s per word: 0.8 s for a short label, 1.2 s minimum for a sentence, more for the hook.
- Fast in, then hold: an entrance of 0.3–0.6 s, a hold, an exit of 0.2–0.4 s.
- Too much text for a scene? Cut words or split the scene. A 4 s scene carries two or three short reads, not six.
- Sequential text (list items, stats) on a fast beat: reveal on every other beat, or reveal them quickly and hold the whole set.
- `check` measures every line through the whole timeline and flags anything too short or flashing by.

## Timing and easing

Never move things linearly (linear is only for slow continuous drifts). Use these curves:

| Use | CSS | JS (`tilecast.ease`) |
|---|---|---|
| Entrances, landing | `cubic-bezier(.16, 1, .3, 1)` | `outExpo` |
| Softer entrances | `cubic-bezier(.33, 1, .68, 1)` | `out` |
| Moves across the screen | `cubic-bezier(.65, 0, .35, 1)` | `inOut` |
| Exits | `cubic-bezier(.7, 0, .84, 0)` | `inExpo` |
| Playful pop with overshoot | `cubic-bezier(.34, 1.56, .64, 1)` | `outBack` |

- Stagger items 40–90 ms apart; words 50–70 ms; letters 20–35 ms.
- Overlap: the next element starts before the previous one finishes (at 60–70% of it).
- Lead with the biggest element, then the details.
- One hero motion per scene; everything else supports it.

## Schedule everything with absolute times

The renderer may jump straight to any moment (parallel capture, the poster frame), so every frame must be a pure function of time. Declare all motion up front with absolute delays from the start of the video, not with timers or class toggles.

**Scene windows.** Each scene fades or cuts in at its start and out at its end:

```css
.scene { position: absolute; inset: 0; opacity: 0; }
/* in at 6.0 s, out at 10.6 s */
#s3 { animation: in .01s 6s both, out .01s 10.6s forwards; }
@keyframes in { from { opacity: 0 } to { opacity: 1 } }
@keyframes out { from { opacity: 1 } to { opacity: 0 } }
```

With `both` the scene is hidden before 6 s and visible after; the later `out` animation (with `forwards`, not `both`) takes over at 10.6 s. The first scene has no `in`: give it `opacity: 1` so frame 0 is never blank. Use a longer duration for fades (`.4s`), or animate `clip-path` or `transform` for wipes and pushes. Never give a scene container `both` on a keyframe that ends visible and nothing to hide it again: it stays on top for the rest of the video.

**Elements inside a scene** get delays relative to the video start:

```css
#s3 h2 { animation: rise .6s cubic-bezier(.16,1,.3,1) 6.15s both; }
#s3 li { animation: rise .5s cubic-bezier(.16,1,.3,1) calc(6.5s + var(--i) * 90ms) both; }
```

Keep a timeline comment at the top of the style block (`/* 0 hook · 2.03 reveal (drop) · 6.1 feature · 10.2 feature · 16.27 logo (final hit) */`) and set `<meta name="tilecast:scenes" content="0 2.03 6.1 10.2 16.27">` so previews show every scene.

**JavaScript motion** (counters, typing, cursors, paths, anything computed) goes in `tilecast.onFrame((t) => …)`, computed from `t` alone:

```js
const count = document.querySelector('.count');
const typed = document.querySelector('.typed');
const text = typed.dataset.text;
tilecast.onFrame((t) => {
  count.textContent = Math.round(tilecast.tween(7.2, 1.4, 0, 12480, 'outExpo')).toLocaleString('pl-PL');
  typed.textContent = text.slice(0, Math.floor(tilecast.tween(3.1, 1.2, 0, text.length, 'linear')));
});
```

`tilecast.progress(start, duration, easing)` gives eased 0..1; `tilecast.tween(start, duration, from, to, easing)` gives a value; `tilecast.random(seed)` gives the same random sequence every frame.

## Techniques

**Line mask reveal:** the line slides up from behind an invisible edge.

```css
/* The padding gives descenders, accents (Ż, Ó) and italic overhangs room inside the mask;
   the negative margin keeps the layout where it was. Without it the mask cuts them off. */
.line { display: block; overflow: hidden; padding: .15em .12em .22em; margin: -.15em -.12em -.22em; }
.line > span { display: block; animation: up .7s cubic-bezier(.16,1,.3,1) 2.1s both; }
@keyframes up { from { transform: translateY(125%) } }
```

**Word stagger:** wrap words in spans with `style="--i: 0"`, `--i: 1` … and delay each with `calc(start + var(--i) * 60ms)`.

**Slam:** `from { transform: scale(1.35); opacity: 0 }` over 0.35–0.45 s with the landing curve, and a soft hit on the exact frame it lands.

**Highlighter:** `background: linear-gradient(var(--accent), var(--accent)) no-repeat 0 85% / 0% 40%` animated to `100% 40%`.

**Camera:** give every scene a slow push, `transform: scale(1)` → `scale(1.06)` across its duration with `inOut`, so even holds feel alive. Parallax: background layers move slower than the foreground.

**Product in use:** rebuild the real UI (the project's own components and CSS), then act on it: a cursor drawn in SVG glides with `inOut`, presses (scale .9 for 80 ms) with a click sound, a panel slides open, a result counts up, a toast pops. This is the strongest material a launch video has.

**Background life:** a slowly drifting gradient, grain, a rotating shape (infinite CSS animations are fine: they are positioned by time too).

**Texture text:** code scrolling behind a scene or a ticker of words is texture, not copy: mark it `aria-hidden="true"` so the reading-time check ignores it. Everything the viewer must read still follows the reading budget.

## Transitions

- **Hard cut on a beat** with a soft hit: the default for energy.
- **Wipe:** the next scene's `clip-path: inset(0 100% 0 0)` → `inset(0)` over 0.4–0.5 s.
- **Push:** the old scene moves out (`translateX(-30%)`, fading) while the new one moves in from the right.
- **Zoom through:** the old scene scales to 1.4 and fades while the new one scales from 0.9 to 1.
- **Dip:** out to the background color for 0.15 s, then in.
- **Match cut:** an element (the logo, a number, a phone) continues from one scene into the next in the same place.
- Avoid a plain crossfade between two busy layouts: it makes a muddy double exposure. Stagger it (old out, then new in) or dip through the background.
- Put a whoosh or swipe on moves and pushes, starting about 0.4 s before the cut.

## Sync with the music

`assets` `make_music` returns the beat grid and the strong cues. Build the edit on them:

- The hook lands at 0; the reveal on the **drop**; scene changes on downbeats; the logo on the **final hit**. Move a major reveal to within ±0.15 s of a strong cue; that is where it feels expensive.
- Sequential accents (cards, dots, icons) on consecutive beats; readable lines on every other beat.
- Mark the locks in your CSS comments (`/* beat-locked 2.03 drop */`).
- Readability and story come first: never cut a line short to hit a beat.

## Formats

- `landscape` 1920×1080 for YouTube, X, LinkedIn, websites. `story` 1080×1920 for Reels, TikTok and Shorts: big type, centered action, nothing important in the top 12% and bottom 18%. `square` or `portrait` for feeds.
- A vertical video is recomposed, not shrunk: stack elements, make type bigger relative to width.

## The ending and the poster

- Hold the final frame (name, promise, call to action) at least 2 seconds; let the music ring out under it.
- Set `tilecast:poster` to the strongest settled frame: the hook line, the reveal or the final logo, text fully in. It becomes frame 0 and the thumbnail everywhere.

## Checklist

- [ ] The first frame is not empty and the hook reads in 2 seconds.
- [ ] Every scene has one idea and one hero motion.
- [ ] Every readable line holds ~0.3 s per word, still and fully visible (`check` agrees).
- [ ] Transitions are staggered or cut, never muddy crossfades.
- [ ] The reveal lands on the drop and the logo on the final hit.
- [ ] The final frame holds 2 s or more with the call to action.
- [ ] Looked at the filmstrip: every scene settled and every cut mid-transition.
