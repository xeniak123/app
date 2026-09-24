# Audio

A silent video feels unfinished. By default every video gets one music bed and a small number of well-timed effects, unless the user turns them off or silence is the stronger creative choice (some `deadpan` pieces). Sound is written with the edit: effects land on the frame the motion lands.

## Music

`assets` `make_music` generates a music bed for the exact length of the video, free to use, and tells you where its beats and strong moments are:

```
assets { action: "make_music", style: "upbeat", duration: 18, dir: "tilecast/launch/audio" }
```

| Style | Tempo | Feel | Tones |
|---|---|---|---|
| `upbeat` | 118 | Bright four-on-the-floor pop groove with a plucked arpeggio | `default`, `app-store`, launches |
| `chill` | 88 | Warm electric piano, soft swung beat, sub bass | `polished`, food, lifestyle |
| `cinematic` | 90 | Big drums, pulsing strings, risers and booms | `cinematic`, dramatic reveals |
| `driving` | 124 | Dark rolling bass, tight hats | `chaotic`, tech, speed |
| `minimal` | 100 | Soft kick, ticks, a marimba motif | `deadpan`, `yc-parody`, explainers |

Options: `bpm` (60–180), `key` ("C", "F#", "Bb minor", "Am"), `seed` for another variation, `name` for the file name. It writes `<name>.wav` and `<name>.cues.json`.

The arrangement always has the same shape, so the edit can rely on it:

- **start (0 s):** a soft accent; the hook lands here.
- **drop (about 2–3 s):** the full beat comes in; put the **reveal** here.
- **breakdown and return** (in longer pieces, 8 bars or more: about 17 s at 118 BPM): the beat drops out for a bar and comes back; a scene change or highlight on the return.
- **final hit:** the last downbeat at least 1.4 s before the end; land the **logo or payoff** here. The music rings out under the final frame.

Place it: `<audio data-tilecast src="audio/music-upbeat.wav" data-start="0" data-volume="0.8"></audio>`.

If the user has their own track, copy it into the piece's folder and use it instead (they know its rights). `assets` `analyze_music` with `file` finds its tempo, beats, bar starts, an energy curve per bar (▁…█) and the strong cues (where the energy jumps, the hardest hits), and saves them next to the track as `.cues.json`. Pick the stretch of the song whose energy curve fits the storyboard, start it there with `data-trim`, and shift the cue times by the same amount. For free-time or ambient music the grid is approximate; follow the energy curve.

## Sync (beat lock)

- Move major reveals to within ±0.15 s of a strong cue (the drop, the return, the final hit). One to three locks per video.
- Snap sequential accents (cards arriving, stats, icons) to consecutive beats from `beats`; for lines people read, every other beat.
- Readability and the story come first; ignore a cue that would cut a line short.
- Note the locks in CSS comments: `/* beat-locked 2.03 drop */`.

## Effects

Generated, WAV (`assets` `make_sfx`, names plus `dir`):

| Name | Use | Placement |
|---|---|---|
| `whoosh` | camera move, push, big transition | starts ~0.45 s before the cut (it peaks at 60%) |
| `swipe` | card, panel or word sliding in | starts ~0.15 s before it lands |
| `riser` | tension into a reveal (`duration` sets its length) | ends exactly on the hit: `data-start` = hit − duration |
| `impact` | title slam, logo hit | on the landing frame |
| `sub-drop` | weight under a reveal or drop | on the reveal |
| `pop` | badge, like, element popping in | on the pop |
| `tick` | counters, typing, list items | per item, quiet (0.2–0.35) |
| `shimmer` | magic moment, success, logo glint | on the glint |

Recorded (Kenney, CC0; `assets` `list_sfx` and `add_sfx`): `soft-hit`, `soft-hit-2`, `soft-hit-3` (warm thuds, the safest hits), `bell-ring` (logo payoff, once), `bell-short`, `bong`, `click`, `click-2`, `tap`, `rollover`, `switch`, `drop`, `card-slide`, `card-place`, `chips`, `glitch`.

## Mixing

- Music at `data-volume` 0.7–0.85, effects at 0.3–0.6 under it. The tool mixes everything and keeps the peak under 0 dB.
- One hero sound per scene; repeated small sounds (ticks, clicks) quieter and not on every single item.
- Clicks on the press, hits on the landing, whooshes ahead of the move.
- Let the final hit and the music ring over the last frame; don't cut sound off with a hard stop.
- Options on every `<audio data-tilecast>`: `data-start` (s), `data-volume` (0–1+), `data-fade-in`, `data-fade-out` (s), `data-trim` (skip the file's first seconds), `data-duration` (play only this long), `loop`.
