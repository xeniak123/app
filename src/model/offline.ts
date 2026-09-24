import { newArtSeed, newId } from './ids';
import { KINDS } from './kinds';
import { hashString } from './layout';
import { PALETTES } from './themes';
import type { Design, Palette, StyleId, Tile, TileKind, TileSize } from './types';

/**
 * Builds a design from a free-text brief without any AI: splits the brief into
 * phrases and sorts them into headline, numbers, details and call to action.
 * Used when no API key is configured, and as the instant first draft.
 */

const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';
const words = (list: string) => new RegExp(`${L}(?:${list})${R}`, 'iu');
const stems = (list: string) => new RegExp(`${L}(?:${list})`, 'iu');

const URL_RE =
  /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:pl|com|eu|org|net|io|app|dev|shop|store|co|de|uk|info|biz)(?:\/\S*)?/i;
const EMAIL_RE = /\S+@\S+\.\w+/;
const PHONE_RE = /\+?\d[\d\s-]{7,}\d/;
const PERCENT_RE = /[-−–]?\s?\d+(?:[.,]\d+)?\s?%/u;
const PRICE_RE = /(?:\d+(?:[.,]\d{1,2})?\s?(?:zł|pln|€|eur|euro|usd|\$|£|gbp)(?![\p{L}]))|(?:[$€£]\s?\d+(?:[.,]\d{1,2})?)/iu;
const FREE_RE = words('wstęp wolny|wstęp bezpłatny|bezpłatnie|gratis|za darmo|free entry|free');
const PLACE_RE = words(
  'park|parku|plac|placu|rynek|rynku|hala|hali|arena|arenie|stadion|stadionie|bulwar|bulwarze|skwer|skwerze|plaża|plaży|dworzec|centrum|online|stream',
);
const TIME_RE = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/;
const DAY_RE = words(
  'poniedziałek|poniedziałki|wtorek|wtorki|środa|środę|środy|czwartek|czwartki|piątek|piątki|sobota|sobotę|soboty|niedziela|niedzielę|niedziele|weekend|weekendy|dziś|dzisiaj|jutro|' +
    'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia|' +
    'monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|january|february|march|april|june|july|august|september|october|november|december',
);
const ADDRESS_RE = /(?:^|\s)(?:ul\.|al\.|pl\.|os\.|ulica|aleja|street|avenue|ave\.|road)\s|\d{2}-\d{3}/iu;
const CTA_RE = words(
  'zamów|zamawiaj|kup|kupuj|zapisz się|zapisz|zapisuj się|sprawdź|odwiedź|przyjdź|przyjdźcie|dołącz|dołączcie|zadzwoń|rezerwuj|zarezerwuj|wpadnij|wpadaj|wpadajcie|pobierz|zobacz|weź|bierz|kliknij|' +
    'order|buy|shop|join|visit|book|call|sign up|register|download|try|get',
);
const BUSINESS_RE = words(
  'pizzeria|kawiarnia|restauracja|bistro|bar|klub|studio|sklep|salon|fundacja|szkoła|akademia|hotel|teatr|kino|galeria|piekarnia|cukiernia|księgarnia|siłownia|cafe|café|shop|store|club|gallery',
);

/** Words that only frame a figure ("Tylko 499 zł"); they stay with the figure. */
const FILLER = new Set(['tylko', 'już', 'od', 'za', 'aż', 'teraz', 'cena', 'koszt', 'only', 'just', 'from', 'now', 'price']);

const ABBREVIATIONS =/(^|\s)(ul|al|pl|os|godz|tel|np|św|ok|ks|dr|prof|nr|m\.in)\.\s/giu;
const GLUE = '\u0001';

const EMOJIS: [RegExp, string][] = [
  [stems('pizz'), '🍕'],
  [stems('burger'), '🍔'],
  [stems('sushi'), '🍣'],
  [stems('kaw[aęyi]|kawiar|coffee|cafe|café|espresso'), '☕'],
  [stems('ciast|tort|cake|cukier|deser|pączk'), '🍰'],
  [stems('lody|lodów|ice cream|gelato'), '🍦'],
  [stems('win[oa]|wine|winiar'), '🍷'],
  [stems('piw|beer|browar'), '🍺'],
  [stems('koncert|muzy|music|festiwal|festival|dj'), '🎵'],
  [stems('impre|party|urodzin|birthday|zabaw'), '🎉'],
  [stems('trening|siłowni|fitness|gym|biegani|maraton|sport'), '💪'],
  [stems('jog[aię]|yoga|medyt'), '🧘'],
  [stems('książ|book|czyta|bibliot'), '📚'],
  [stems('kurs|szkoleni|warsztat|lekcj|course|workshop|webinar'), '🎓'],
  [stems('kwiat|flower|ogród|ogrod|garden|rośli'), '🌸'],
  [stems('pies|psa|psy|psów|dog|zwierz|kot|cat'), '🐾'],
  [stems('kino|film|movie|cinema'), '🎬'],
  [stems('gaming|gier|game'), '🎮'],
  [stems('podróż|wakacj|travel|urlop'), '✈️'],
  [stems('rower|bike'), '🚲'],
  [stems('fryzj|beauty|urod|kosmet|makijaż|paznok'), '💅'],
  [stems('zdrow|lekarz|klinik|health|dent'), '🩺'],
  [stems('eko|recykl|natur'), '🌿'],
  [stems('techn|aplikac|softw|startup|kod|programow'), '🚀'],
  [stems('promoc|rabat|zniżk|sale|wyprzeda|okazj|black friday'), '🔥'],
  [stems('święt|christmas|mikołaj'), '🎄'],
  [stems('walentyn|miłoś|love'), '❤️'],
  [stems('otwarci|premier|nowość|nowy|nowa|launch'), '✨'],
];

const STYLE_RULES: [RegExp, StyleId][] = [
  [stems('win[oa]|wine|elegan|luksus|luxury|hotel|ślub|wesel|wedding|biżuter|jewel|galeri|teatr|opera|premium|spa'), 'elegant'],
  [stems('dzieci|dziecię|kids|zabaw|urodzin|party|impre|festyn|lody|cukier|zwierz|pies|psa|kot|piknik|lato|summer'), 'playful'],
  [stems('techn|aplikac|softw|startup|konferenc|conference|design|architekt|meetup|webinar|kod|programow|\\bai\\b'), 'minimal'],
];

const PALETTE_RULES: [RegExp, string][] = [
  [stems('pizz|burger|jedzen|food|restaur|kuchni|grill|bbq|kebab'), 'Pomidor'],
  [stems('techn|konferenc|biznes|business|finans|prawn|startup|webinar|aplikac'), 'Granat'],
  [stems('eko|zdrow|jog[aię]|yoga|natur|ogród|ogrod|rośli|vegan|wegań|spa'), 'Mięta'],
  [stems('urod|beauty|kosmet|walentyn|kwiat|ciast|cukier|lody|tort'), 'Róż'],
  [stems('podróż|travel|wakac|morze|basen|żegl|rejs'), 'Ocean'],
  [stems('rower|bike|górsk|trekking|biwak|outdoor|las\\b'), 'Las'],
  [stems('kaw[aęyi]|kawiar|coffee|cafe|chleb|piekar|ceramik|rękodzieł|handmade|win[oa]|wine'), 'Terakota'],
  [stems('dzieci|kids|lato|summer|festyn|piknik|lemoniad'), 'Cytryna'],
  [stems('koncert|muzy|music|klub|noc|night|film|kino|gaming|dj'), 'Grafit'],
  [stems('elegan|galeri|książ|book|architekt|design|minimal'), 'Papier'],
];

interface Parsed {
  brand: string[];
  content: string[];
  numbers: string[];
  info: string[];
  cta: string[];
}

function splitBrief(brief: string): string[] {
  const protectedText = brief.replace(ABBREVIATIONS, (_m, lead: string, abbr: string) => `${lead}${abbr}.${GLUE}`);
  return protectedText
    .split(/\n+|(?<=[.!?])\s+|\s*[;|•]\s*|\s+[–—-]\s+|,\s+/u)
    .map((part) => part.replaceAll(GLUE, ' ').trim())
    .filter((part) => part.length > 0);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .replace(/\.$/, '')
    .trim();
}

function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : '';
}

function isBrand(segment: string): boolean {
  const list = segment.split(/\s+/);
  if (list.length > 4 || /[!?]/.test(segment)) return false;
  if (BUSINESS_RE.test(segment) && list.length >= 2) return true;
  const capitalized = list.filter((w) => /^\p{Lu}/u.test(w));
  return list.length >= 2 && capitalized.length === list.length;
}

function parse(brief: string): Parsed {
  const parsed: Parsed = { brand: [], content: [], numbers: [], info: [], cta: [] };
  for (const segment of splitBrief(brief)) {
    let rest = segment;
    let hadNumber = false;
    for (const re of [PERCENT_RE, PRICE_RE, FREE_RE]) {
      const match = rest.match(re);
      if (match) {
        const figure = match[0]
          .replace(/\s+/g, ' ')
          .replace(/^[-−–]\s?/, '-')
          .replace(/\s%/, '%')
          .trim();
        parsed.numbers.push(capitalize(figure));
        rest = rest.replace(match[0], ' ');
        hadNumber = true;
      }
    }
    rest = tidy(rest);
    if (!/[\p{L}\p{N}]/u.test(rest)) continue;
    if (hadNumber && rest.split(/\s+/).every((word) => FILLER.has(word.toLocaleLowerCase()))) {
      parsed.numbers[parsed.numbers.length - 1] = capitalize(tidy(segment).replace(/[!?]+$/, ''));
      continue;
    }

    const hasContact = URL_RE.test(rest) || EMAIL_RE.test(rest) || PHONE_RE.test(rest);
    if (CTA_RE.test(rest) && (hasContact || wordCount(rest) <= 6)) {
      parsed.cta.push(rest);
    } else if (hasContact && wordCount(rest) <= 4) {
      parsed.cta.push(rest);
    } else if (
      ADDRESS_RE.test(rest) ||
      TIME_RE.test(rest) ||
      ((DAY_RE.test(rest) || PLACE_RE.test(rest)) && wordCount(rest) <= 5)
    ) {
      parsed.info.push(rest);
    } else if (isBrand(rest)) {
      parsed.brand.push(rest);
    } else if (parsed.content.length > 0 && wordCount(rest) <= 2 && !hadNumber) {
      // A stray word or two after the main sentence is usually a place or a detail ("Kraków").
      parsed.info.push(rest);
    } else {
      parsed.content.push(rest);
    }
  }
  return parsed;
}

function pickEmoji(brief: string): string | null {
  for (const [re, emoji] of EMOJIS) if (re.test(brief)) return emoji;
  return null;
}

export function pickStyle(brief: string): StyleId {
  for (const [re, style] of STYLE_RULES) if (re.test(brief)) return style;
  return 'bold';
}

export function pickPalette(brief: string): Palette {
  for (const [re, name] of PALETTE_RULES) {
    if (re.test(brief)) return PALETTES.find((p) => p.name === name) ?? PALETTES[0];
  }
  return PALETTES[hashString(brief) % PALETTES.length];
}

export function makeTile(kind: TileKind, text: string, size?: TileSize): Tile {
  const spec = KINDS[kind];
  const tile: Tile = { id: newId(), kind, text, size: size ?? spec.defaultSize, tone: spec.defaultTone };
  if (kind === 'image') tile.art = { seed: newArtSeed() };
  return tile;
}

export function designFromBrief(brief: string): Design {
  const parsed = parse(brief);

  // The headline is the first real sentence; fall back to the brand or anything at all.
  let headline = capitalize(
    parsed.content.shift() ?? parsed.brand.shift() ?? parsed.info.shift() ?? parsed.cta.shift() ?? '',
  );
  if (!headline) headline = parsed.numbers.length ? 'Nie przegap!' : 'Twoje hasło';
  let overflow = '';
  if (headline.length > 70) {
    const cut = headline.lastIndexOf(' ', 60);
    overflow = headline.slice(cut + 1);
    headline = `${headline.slice(0, cut)}…`;
  }

  const body = capitalize(tidy([overflow, ...parsed.content].filter(Boolean).join('. ')).slice(0, 180));
  const emoji = pickEmoji(brief);

  const tiles: Tile[] = [];
  if (parsed.brand.length) tiles.push(makeTile('brand', parsed.brand[0]));
  tiles.push(makeTile('headline', headline, headline.length > 38 ? 'XL' : 'L'));
  tiles.push(makeTile('image', ''));
  if (parsed.numbers.length) tiles.push(makeTile('number', parsed.numbers[0]));
  if (body) tiles.push(makeTile('text', body));
  const info = [...parsed.info, ...parsed.brand.slice(1), ...parsed.numbers.slice(1), ...parsed.cta.slice(1)];
  if (info.length) tiles.push(makeTile('info', info.slice(0, 3).join('\n')));
  if (emoji) tiles.push(makeTile('emoji', emoji));
  if (parsed.cta.length) {
    const cta = capitalize(parsed.cta[0]);
    tiles.push(makeTile('cta', /[→>]$/.test(cta) ? cta : `${cta} →`));
  }

  return { tiles, palette: pickPalette(brief), style: pickStyle(brief), seed: 0 };
}
