# Plan: Tilecast launch video

## What is it?
An MCP server, skill and Claude Code plugin with which a coding agent designs posters, announcements and videos from scratch as web pages, checks them with a design critic and renders print PDFs, PNGs and MP4s.

## Angle
The agent you already code with can now design, and it does it the way it writes everything else: as a web page. Show the product in use, from the prompt to the files.

## Hook (0–2 s)
A prompt types itself on a dark screen: `> make a poster for our jazz night`. Everyone who uses a coding agent recognises it instantly.

## Key moments
1. The poster builds itself while its HTML and CSS appear line by line (the reveal, on the drop).
2. The critic finds three real problems, fixes land one by one in the breakdown, and PASS slams on the beat's return.
3. The same work comes out as a 300 dpi print, a square post, a story and an MP4.

## Payoff
Tilecast. "Design, by your coding agent." Plugin, MCP server and the repository address.

## Tone
- Preset: `default`, leaning `app-store` for the product scenes.
- Interpretation: confident and playful, fast cuts on the beat, every line held long enough to read.

## Format: landscape 1920×1080, 30 fps. Duration: 20.5 s.

## Visual identity
- Background `#0d0d10`, text `#f4f1ea`, accent `#ff5a1f`, pass `#3ddc97`, fail `#ff5d5d`.
- Display: Bricolage Grotesque 800. Text: Inter. Code: JetBrains Mono.
- The jazz poster from `examples/jazz` is the product being made; the renders from `examples/*/export` are the results.

## Audio (make_music upbeat, seed 3, 118 BPM)
- Strong cues: 0 start · 2.03 drop · 12.2 return after the breakdown · 18.3 final hit.
- Reveal locked to the drop, PASS locked to the return, logo locked to the final hit.
- Effects: ticks under the typing, whoosh into the drop, pops as poster layers land, swipes for the result cards, a riser through the breakdown, impact on the logo.

## Storyboard

| # | Start | Scene | On screen | Motion | Sound |
|---|---|---|---|---|---|
| 1 | 0.00 | Hook | "your coding agent" label, prompt types in | typing, cursor blink | ticks, click on enter |
| 2 | 2.03 | Reveal (drop) | prompt moves up; code panel left, poster card builds right; caption "It writes HTML and CSS. From scratch." | layers land on beats, slow push | whoosh, impact, pops |
| 3 | 6.10 | Critic | "A critic that checks every pixel." + three ✗ findings; fixes in the breakdown; PASS on the return | findings every other beat, ✗→✓, stamp | ticks, riser, soft hit |
| 4 | 13.22 | Results | "Print PDF. Social. MP4 with music." + four result cards | cards fly in on beats, push in | swipes |
| 5 | 18.30 | Payoff (final hit) | Tilecast, tagline, plugin line and repository | slam, hold | impact, music rings out |

Reading budget: hook prompt 7 words (held 1.1 s before it moves, then again from 2.5 s to 5.9 s); captions 5–7 words with 2–3 s holds; findings 4–5 words held 3–5 s; payoff lines held 1.9–2.1 s.
