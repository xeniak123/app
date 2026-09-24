import { describe, expect, it } from 'vitest';
import { designFromBrief } from './offline';

const byKind = (brief: string) => {
  const design = designFromBrief(brief);
  const map = new Map(design.tiles.map((t) => [t.kind, t.text]));
  return { design, map };
};

describe('designFromBrief', () => {
  it('sorts a Polish promo brief into tiles', () => {
    const { design, map } = byKind(
      'Pizzeria Roma – w każdy piątek -30% na wszystkie pizze! Zamów na roma.pl, ul. Długa 5, Kraków',
    );
    expect(map.get('brand')).toBe('Pizzeria Roma');
    expect(map.get('headline')).toBe('W każdy piątek na wszystkie pizze!');
    expect(map.get('number')).toBe('-30%');
    expect(map.get('cta')).toBe('Zamów na roma.pl →');
    expect(map.get('info')).toBe('ul. Długa 5\nKraków');
    expect(map.get('emoji')).toBe('🍕');
    expect(map.has('image')).toBe(true);
    expect(design.palette.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles an English event brief', () => {
    const { design, map } = byKind('Summer jazz night in the park. Free entry. Saturday 20:00. Book at jazz.com');
    expect(map.get('headline')).toBe('Summer jazz night in the park');
    expect(map.get('number')).toBe('Free entry');
    expect(map.get('info')).toContain('Saturday 20:00');
    expect(map.get('cta')).toContain('jazz.com');
    expect(design.tiles.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the words around a freebie as copy, not as details', () => {
    const { map } = byKind('Otwieramy kawiarnię Ziarno! Pierwsza kawa gratis. 12.10 od 8:00, ul. Polna 3');
    expect(map.get('headline')).toBe('Otwieramy kawiarnię Ziarno!');
    expect(map.get('number')).toBe('Gratis');
    expect(map.get('text')).toBe('Pierwsza kawa');
    expect(map.get('info')).toBe('12.10 od 8:00\nul. Polna 3');
  });

  it('treats venues as details and free entry as the key figure', () => {
    const { map } = byKind(
      'Koncert jazzowy pod gwiazdami. Wstęp wolny! Sobota 20:00, Park Miejski. Rezerwuj miejsce na jazzwparku.pl',
    );
    expect(map.get('headline')).toBe('Koncert jazzowy pod gwiazdami');
    expect(map.get('number')).toBe('Wstęp wolny');
    expect(map.get('info')).toBe('Sobota 20:00\nPark Miejski');
    expect(map.has('brand')).toBe(false);
    expect(map.get('cta')).toBe('Rezerwuj miejsce na jazzwparku.pl →');
  });

  it('keeps framing words with the price', () => {
    const { map } = byKind(
      'Kurs programowania dla początkujących – 8 tygodni nauki od zera. Tylko 499 zł. Zapisz się na kodujzami.pl',
    );
    expect(map.get('number')).toBe('Tylko 499 zł');
    expect(map.get('text')).toBe('8 tygodni nauki od zera');
    expect(map.get('cta')).toBe('Zapisz się na kodujzami.pl →');
  });

  it('never returns an empty design', () => {
    for (const brief of ['', '   ', '!!!', '50 zł']) {
      const design = designFromBrief(brief);
      expect(design.tiles.some((t) => t.kind === 'headline' && t.text.length > 0)).toBe(true);
    }
  });

  it('shortens very long headlines', () => {
    const long = 'To jest bardzo długie zdanie które zdecydowanie nie zmieści się jako hasło na plakacie w całości i trzeba je skrócić';
    const { map } = byKind(long);
    expect(map.get('headline')!.length).toBeLessThanOrEqual(62);
    expect(map.get('text')).toBeTruthy();
  });

  it('picks a style from the topic', () => {
    expect(designFromBrief('Degustacja win w naszym hotelu').style).toBe('elegant');
    expect(designFromBrief('Urodziny dla dzieci z animatorem').style).toBe('playful');
    expect(designFromBrief('Konferencja o AI i startupach').style).toBe('minimal');
  });
});
