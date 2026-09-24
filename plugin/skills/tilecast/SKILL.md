---
name: tilecast
description: Design posters, flyers, social media posts, Instagram/TikTok stories and banners with the Tilecast MCP tools. One tile-based design renders into an A4 poster, a 1:1 post, a 9:16 story and a 16:9 banner, exported as PNG and standalone HTML. Use whenever the user wants a promotional graphic for an event, sale, product, opening, course or announcement ("make a poster", "Instagram post for…", "zrób plakat", "grafika na story").
---

# Tilecast: posters and social graphics from tiles

You design the content; Tilecast lays it out. A design is an ordered list of tiles.
A layout engine arranges the same tiles into four formats at once: A4 poster
(2480×3508), square post (1080×1080), story (1080×1920) and banner (1920×1080).
Tile order is reading order: earlier tiles land top-left in every format.

Tools (MCP server `tilecast`): `create_design`, `update_design`, `preview_design`,
`export_design`, `list_designs`, `get_design`. If they are not available, tell the
user to install the Tilecast plugin or add the MCP server (see the project README).

## 1. Collect the facts

You need: what it is, the key offer or message, when, where, price or figure, link
or contact, organizer. Use what the user gave you; ask one short question only when
something essential is missing (for example the date of an event). **Never invent
prices, dates, addresses, phone numbers, links or names.**

## 2. Write the tiles

Write the copy in the user's language. Poster copy is short: people glance, they
don't read.

| kind | what goes in | typical size | good tones |
| --- | --- | --- | --- |
| `headline` | the main message, 2–7 words, exactly one | L or XL | clear, accent |
| `image` | picture slot: `image_path` for a real photo, otherwise generated artwork (see Pictures) | L | accent |
| `number` | one striking figure: `-30%`, `49 zł`, `12.10`, `Free entry` (≤ 12 chars) | M or L | accent |
| `text` | one or two supporting sentences (≤ 120 chars) | M | surface |
| `info` | when / where / contact, up to 3 short lines separated by `\n` | S | surface, clear |
| `cta` | what to do next, with the link: `Order at roma.pl →` (≤ 30 chars) | S | ink |
| `emoji` | one emoji that fits the topic | S | surface |
| `brand` | organizer or company name, or a logo via `image_path` | S | clear |

- 5–9 tiles. Headline near the start, cta near the end, brand usually first.
- Sizes are shares of the area (S=1, M=2, L=3.5, XL=5.5): give the most important
  tiles the most area, and keep details S.
- Tones: `accent` (accent color), `surface` (card), `ink` (inverted, high contrast),
  `clear` (no background). Give neighbouring tiles different tones and save
  `accent` for the one or two things that must pop.
- Style: `bold` (loud, condensed uppercase: sales, sport, food), `elegant` (serif:
  culture, wine, weddings, premium), `playful` (rounded: kids, parties, summer),
  `minimal` (grotesk: tech, conferences, courses).
- Palettes: Pomidor, Granat, Mięta, Papier, Róż, Ocean, Las, Terakota, Cytryna,
  Grafit, or your own hex `colors` (bg, surface, ink, accent, accentInk). Match the
  brand or topic; text colors that would be unreadable are corrected automatically.

Example `create_design` call:

```json
{
  "name": "pizza-friday",
  "style": "bold",
  "palette": "Pomidor",
  "tiles": [
    { "kind": "brand", "text": "Pizzeria Roma" },
    { "kind": "headline", "text": "Every Friday: pizza night", "size": "L" },
    { "kind": "image", "image_path": "assets/pizza.jpg" },
    { "kind": "number", "text": "-30%", "tone": "accent" },
    { "kind": "info", "text": "Fridays 12:00–22:00\n5 Long St, Kraków" },
    { "kind": "cta", "text": "Order at roma.pl →" }
  ]
}
```

## Pictures

An image tile without a photo gets generated artwork in the design's colors: a
motif (`sunburst`, `waves`, `blobs`, `bauhaus`, `halftone`, `stripes`, `rings`,
`arches`, `mesh`, `confetti`, `landscape`, `grid`) plus an icon that matches the
topic of the copy (a music note for a concert, a cup for a café…). Every new
design gets a different picture.

- Check the picture in the preview. If the icon or motif doesn't suit the
  message, use `set_tile` with `art` (a motif, or `auto`) and `icon` (an icon
  name, `auto` or `none`), or the `shuffle_art` operation for a different random
  picture.
- Real photos work best for food, products, places and people. Use the user's
  photos (`image_path`). If you have an image-generation or stock-photo tool,
  create or download a fitting photo into the project and pass its path. Don't
  reuse one photo across unrelated designs.

## 3. Review the preview and iterate

Every create/update call returns a preview image of all four formats. Look at it
before you show it to the user, and fix what reads badly:

- **Text too small** → the copy is too long for its tile: shorten it, or make the
  tile bigger (`set_tile` with a larger `size`).
- **Weak hierarchy** (headline doesn't dominate) → headline `XL`, details `S`.
- **Awkward arrangement** → `swap_tiles` / `move_tile` to change the order, or
  `next_layout` to try another arrangement of the same tiles.
- **Picture doesn't fit** → `set_tile` with `art` / `icon`, `shuffle_art`, or a real photo.
- **Flat or noisy colors** → change tones so neighbours differ, try another palette.

Batch several operations into one `update_design` call. Two or three rounds are
usually enough; then show the user the preview and ask whether the direction is
right before polishing further.

## 4. Export

`export_design` writes to `tilecast/export/<id>/` (or `out_dir`, inside the project):

- PNG in full resolution for every format (the poster is 300 dpi, ready to print).
- Standalone HTML per format with fonts and images inlined and an entrance
  animation (`animate`). Open it in a browser, or put the `.canvas` markup into a
  web page, e.g. with `out_dir: "public/promo"` in a web project.

PNG export needs Chrome, Chromium or Edge. If the tool reports that none was found,
the HTML export still works; tell the user to install Chrome or run
`npx playwright install chromium`, or to set `TILECAST_CHROME`.

Designs are saved as `tilecast/<id>.tilecast.json`; use `list_designs` and
`get_design` to pick up earlier work.
