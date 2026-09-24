// Line icons from Lucide (https://lucide.dev, ISC license) used as topic
// illustrations in generated artwork. Only this curated set is bundled.
const files = import.meta.glob(
  '/node_modules/lucide-static/icons/{music,guitar,mic-vocal,piano,headphones,drum,pizza,coffee,utensils,chef-hat,soup,hamburger,ice-cream-cone,cake-slice,croissant,wine,beer,martini,graduation-cap,book-open,pencil,school,dumbbell,trophy,bike,volleyball,medal,flower,flower-2,leaf,sprout,trees,mountain,tent,sun,paw-print,dog,cat,clapperboard,film,popcorn,gamepad-2,dices,puzzle,plane,tree-palm,map,luggage,sailboat,shopping-bag,store,tag,percent,badge-percent,gift,rocket,cpu,code,laptop,bot,party-popper,cake,heart,tree-pine,snowflake,scissors,gem,sparkles,stethoscope,heart-pulse,house,key,car,library,palette,brush,camera,calendar,ticket,star,megaphone,baby}.svg',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** Icon name → the SVG elements inside Lucide's 24×24 viewBox. */
export const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([file, svg]) => [
    file.slice(file.lastIndexOf('/') + 1, -'.svg'.length),
    svg
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>[\s\S]*$/, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ]),
);

export const ICON_NAMES = Object.keys(ICONS).sort();

const L = '(?<![\\p{L}\\p{N}])';
const stems = (list: string) => new RegExp(`${L}(?:${list})`, 'iu');

/** Topics recognised in the design's copy, most specific first, with fitting icons. */
const TOPICS: [RegExp, string[]][] = [
  [stems('pizz'), ['pizza']],
  [stems('burger|hamburg'), ['hamburger']],
  [stems('kaw[aęyi]|kawiar|coffee|cafe|café|espresso|latte'), ['coffee', 'croissant']],
  [stems('ciast|tort|cake|cukier|deser|pączk|piekar|bakery'), ['cake-slice', 'croissant']],
  [stems('lody|lodów|ice cream|gelato'), ['ice-cream-cone']],
  [stems('win[oa]|wine|winiar|degustac'), ['wine']],
  [stems('piw|beer|browar'), ['beer']],
  [stems('koktajl|cocktail|drink'), ['martini']],
  [stems('restaur|kuchni|obiad|kolacj|jedzeni|food|dinner|lunch|bistro|grill|bbq'), ['utensils', 'chef-hat', 'soup']],
  [
    stems('jazz|koncert|muzy|music|festiwal|festival|dj|gig(?![\\p{L}])|zespo|band(?![\\p{L}])|płyt|rock(?![\\p{L}])|disco|orkiestr|filharmoni'),
    ['music', 'guitar', 'mic-vocal', 'headphones', 'piano', 'drum'],
  ],
  [stems('impre|party|urodzin|birthday|zabaw|sylwest'), ['party-popper', 'cake', 'gift']],
  [stems('trening|siłowni|fitness|gym|biegani|maraton|sport|mecz|turniej|zawod|match|run'), ['dumbbell', 'trophy', 'medal', 'volleyball']],
  [stems('rower|bike|cycling'), ['bike']],
  [stems('jog[aię]|yoga|medyt|wellness|spa(?![\\p{L}])'), ['flower-2', 'sparkles', 'leaf']],
  [stems('książ|book|czyta|bibliot|library|literat'), ['book-open', 'library']],
  [stems('kurs|szkoleni|warsztat|lekcj|course|workshop|webinar|szkoł|school|studi|nauk'), ['graduation-cap', 'pencil', 'school', 'book-open']],
  [stems('kwiat|flower|ogród|ogrod|garden|rośli|plant'), ['flower', 'sprout', 'leaf']],
  [stems('eko|recykl|natur|las(?![\\p{L}])|lasu|lesie|forest|drzew'), ['trees', 'leaf', 'sprout']],
  [stems('gór|mountain|trekking|wędrów|hik|biwak|camp'), ['mountain', 'tent', 'trees']],
  [stems('pies(?![\\p{L}])|piesk|psa|psy|psów|dogs?(?![\\p{L}])|kot(?![\\p{L}])|kota|koty|kotów|kotk|cats?(?![\\p{L}])|zwierz|pets?(?![\\p{L}])|schronisk'), ['paw-print', 'dog', 'cat']],
  [stems('kino|film|movie|cinema|seans'), ['clapperboard', 'film', 'popcorn']],
  [stems('gaming|gier|game|planszów'), ['gamepad-2', 'dices', 'puzzle']],
  [stems('podróż|wakacj|travel|urlop|wycieczk|trip|flight'), ['plane', 'luggage', 'tree-palm', 'map']],
  [stems('morze|morsk|rejs|żegl|sail|boat|plaż|beach'), ['sailboat', 'sun', 'tree-palm']],
  [stems('promoc|rabat|zniżk|sale(?![\\p{L}])|wyprzeda|okazj|black friday|discount'), ['badge-percent', 'tag', 'shopping-bag', 'percent']],
  [stems('sklep|shop|store|zakup|kolekcj|moda|fashion'), ['shopping-bag', 'store', 'tag']],
  [stems('techn|aplikac|softw|startup|kod|programow|developer|hackathon|ai(?![\\p{L}])'), ['rocket', 'code', 'laptop', 'cpu', 'bot']],
  [stems('święt|christmas|mikołaj|choink|zim[aąy]|winter'), ['tree-pine', 'snowflake', 'gift']],
  [stems('walentyn|miłoś|love|ślub|wesel|wedding'), ['heart', 'gem']],
  [stems('fryzj|beauty|urod|kosmet|makijaż|paznok|barber'), ['scissors', 'sparkles', 'gem']],
  [stems('zdrow|lekarz|klinik|health|dent|przychodni'), ['stethoscope', 'heart-pulse']],
  [stems('mieszka|nieruchom|apartament|real estate|house'), ['house', 'key']],
  [stems('samoch|motoryz|car(?![\\p{L}])'), ['car']],
  [stems('wystaw|galeri|sztuk|malar|exhibit|muze|art(?![\\p{L}])'), ['palette', 'brush', 'gem']],
  [stems('fotograf|photo'), ['camera']],
  [stems('dzieci|dziecię|kids|child|rodzin|family|przedszk'), ['baby', 'puzzle', 'party-popper']],
  [stems('konferenc|conference|meetup|spotkani|event|wydarzen|premier|launch|otwar|opening'), ['megaphone', 'calendar', 'star', 'sparkles']],
];

/** An icon that fits what the copy is about, varied by `seed`; null when no topic is recognised. */
export function topicIcon(text: string, seed: number): string | null {
  for (const [re, icons] of TOPICS) if (re.test(text)) return icons[Math.abs(seed) % icons.length];
  return null;
}
