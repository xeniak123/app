# Tones

Seven presets. Each sets the voice of the copy, the type, the color, the layout energy, the video pacing and the music. They are starting points: a freeform direction ("fake Series A launch from 2016", "museum exhibit", "overproduced mobile game ad") maps to the nearest preset for structure and keeps its own flavor.

Adapted from the tone system of [/brag](https://github.com/latent-spaces/brag) (MIT), extended to posters and announcements.

---

## `default`

**Energy:** Playful, clean, postable. The subject gets to be fun on its own terms.

**Copy:** Warm and direct, first person plural. Short sentences. No corporate words.

**Type and color:** Mixed case, a characterful grotesk (Bricolage Grotesque, Syne) with Inter; one bright accent on a calm field.

**Poster:** One big idea with a bit of wit: the headline set huge, a cropped shape or the product, the facts in a tidy block.

**Video:** 4–5 scenes of 3–5 s. Snappy entrances, clean slides or cuts. Music: `upbeat`.

**Example:**
```
Dating apps were built for humans.
Obvious mistake.
→ Horse Tinder. Find your perfect stablemate.
```

---

## `polished`

**Energy:** Serious and elegant. Restraint is the creative choice.

**Copy:** Third person or no voice at all; the subject speaks for itself. One statement per scene.

**Type and color:** Editorial serif (Instrument Serif, Fraunces, Playfair Display) with a quiet sans; light to medium weights, generous letter-spacing on labels; a dark or ivory field with one metallic or deep accent.

**Poster:** Lots of air, fine rules, a frame or a strict grid; the product or photo treated like a gallery piece.

**Video:** 3–4 scenes of 4–6 s, slow reveals, soft fades of 0.6–0.8 s, a slow camera push. Music: `chill`.

---

## `yc-parody`

**Energy:** A deadpan startup launch. The joke is how seriously it is delivered.

**Copy:** Matter-of-fact claims and metrics, no winking. The absurdity comes from the subject.

**Type and color:** Heavy sans in sentence case, monospaced numbers (JetBrains Mono, Space Mono), white or black keynote backgrounds, one brand color.

**Poster:** One enormous claim or number, a tiny footnote.

**Video:** 4–5 scenes, one claim each, hard cuts on the beat. Music: `minimal` or `upbeat`.

**Example:**
```
Every day, taxis carry us.
But who carries the taxis?
→ Taxi for Taxis. Available in 12 metros.
```

---

## `chaotic`

**Energy:** FAST, LOUD, unhinged. The video is the joke.

**Copy:** SHORT WORDS. CAPS. Numbers. Confidence instead of exclamation marks.

**Type and color:** Condensed caps (Anton, Bebas Neue, Archivo Black), oversized, some words tilted; clashing high-contrast colors, stickers, halftone.

**Poster:** Type bleeding off the edges, a rotated sticker, diagonal bands.

**Video:** 6–8 scenes, some under 2 s, never more than 4 s. Hard cuts, flash frames, zoom cuts (scale 1.2 → 1). Text still gets its reading time: slam it in and hold. Music: `driving`.

---

## `deadpan`

**Energy:** Calm and dry. Nothing registers as unusual.

**Copy:** One quiet observation, then the subject. That's it.

**Type and color:** Mixed case, large but light, a neutral field, almost no color.

**Poster:** Vast empty space, one small line of type placed with care.

**Video:** 3–4 scenes of 4–7 s, one thought at a time, slow fades or long holds. The pace is the joke. Music: `minimal`, quiet.

---

## `cinematic`

**Energy:** Trailer scale. The subject is treated like a blockbuster.

**Copy:** Short, epic declarative lines. Each lands before the next begins.

**Type and color:** Heavy caps or a dramatic serif, very large; dark scenes with light sources (radial glows), grain, full-bleed imagery.

**Poster:** A dark, dramatic image with a title that fills the width, credits-style small print.

**Video:** 4–5 scenes of 3–5 s, dramatic wipes, scale-in reveals (0.95 → 1), a riser into each reveal and a boom on the title. Music: `cinematic`.

**Example:**
```
For too long, fish were told to stay underwater.
→ FISH FLIGHT SCHOOL. The sky was never the limit.
```

---

## `app-store`

**Energy:** Clean, professional, feature-forward.

**Copy:** Feature and benefit, present tense. A name and one supporting line per card.

**Type and color:** Title case, medium weight (Inter, Manrope, Instrument Sans), soft light backgrounds, the product UI in device frames with layered shadows.

**Poster:** The product front and center, three short benefits, a clear call to action.

**Video:** 4–6 scenes, smooth slides and wipes of 0.35–0.45 s, the product in use. Music: `upbeat` or `chill`.

---

## Announcements and events

Most real requests are announcements: a concert, an opening, a sale, a workshop, a meeting. Pick the tone from the event itself:

| Event | Tone | Notes |
|---|---|---|
| Concert, party, festival | `default` or `cinematic` | Date and place big, the headliner bigger |
| Restaurant, café, food | `default` or `polished` | Warm palette, the dish or the offer as hero |
| Sale, promotion | `chaotic` or `default` | The number is the hero ("-40%"), the deadline clear |
| Conference, workshop, course | `polished` or `app-store` | Program as a grid, speakers, the call to register |
| Product launch, release | any, from the project's own character | Show the product in use |
| Community, school, charity | `default` or `deadpan` | Human, clear, generous type |
