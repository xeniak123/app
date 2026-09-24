# Tilecast

**Jedna treść, każdy format.** Opisujesz, co chcesz wypromować, a AI rozkłada treść na kafelki i od razu układa z nich plakat A4, post 1:1, story 9:16 i baner 16:9. Kafelki przestawiasz myszką, a zmiana pojawia się we wszystkich formatach naraz. Wszystko jest zwykłym HTML/CSS, więc tekst jest zawsze poprawny i ostry, a eksport do PNG działa w pełnej rozdzielczości (plakat w 300 dpi).

![Tilecast: jeden projekt w czterech formatach](docs/screenshot.png)

## Co potrafi

- **Projekt z jednego zdania.** Wpisz np. „Pizzeria Roma – w piątek -30%, zamów na roma.pl”, a powstanie nagłówek, liczba, szczegóły i wezwanie do działania.
- **4 formaty naraz.** Silnik układu dopasowuje te same kafelki do każdych proporcji, bez dziur i nakładania się.
- **Przeciąganie kafelków.** Upuść kafelek na inny, żeby zamienić je miejscami. Jest też cofanie i ponawianie (Ctrl+Z / Ctrl+Shift+Z).
- **Edycja kafelka:** treść, rodzaj, rozmiar (S–XL), tło (akcent / karta / kontrast / bez tła), własne zdjęcie albo logo.
- **Wygląd:** 4 style typografii, 10 palet, własne kolory i przycisk „Inny układ”, który daje kolejne warianty.
- **AI (Claude):** projekt z opisu oraz zmiany poleceniem, np. „bardziej elegancko” albo „dodaj godziny 12–22”. Twoje ręczne poprawki i zdjęcia zostają.
- **Tryb offline:** bez klucza API projekt powstaje z prostych reguł, więc aplikację da się wypróbować od razu.
- **Eksport PNG** każdego formatu w docelowej rozdzielczości, z osadzonymi fontami.
- **Animacja wejścia kafelków** jako podgląd. To pierwszy krok do eksportu wideo.
- Projekt zapisuje się automatycznie w przeglądarce.

![Przykładowy eksport 1080×1080](docs/export-square.png)

## Uruchomienie

Potrzebny jest Node.js 20 lub nowszy.

```bash
npm install
cp .env.example .env   # opcjonalnie: wpisz ANTHROPIC_API_KEY, żeby projektowało AI
npm run dev
```

Otwórz http://localhost:5173.

Bez klucza aplikacja działa w trybie offline. Z kluczem przycisk zmienia się na „Zaprojektuj z AI”. Domyślny model to `claude-opus-5`; inny ustawisz zmienną `TILECAST_MODEL` w `.env`.

| Polecenie | Co robi |
| --- | --- |
| `npm run dev` | serwer deweloperski z API |
| `npm test` | testy jednostkowe (Vitest) |
| `npm run typecheck` | sprawdzenie typów TypeScript |
| `npm run build` | build produkcyjny do `dist/` |
| `npm run preview` | podgląd buildu produkcyjnego razem z API |

## Jak to działa

- **Silnik układu** (`src/model/layout.ts`) dzieli płótno rekurencyjnie na dwie części, jak w treemapie. Dzięki temu kafelki zawsze wypełniają całość. Programowanie dynamiczne sprawdza wszystkie cięcia i wybiera układ, w którym każdy kafelek ma pasujący kształt: nagłówek szeroki, zdjęcie mniej więcej kwadratowe, przycisk płaski. Kolejność kafelków to kolejność czytania.
- **Dopasowanie tekstu** (`src/lib/fitText.ts`) szuka największego rozmiaru fontu, przy którym tekst mieści się w kafelku bez łamania słów.
- **Kolory** (`src/model/paint.ts`, `src/model/color.ts`) pilnują kontrastu: jeśli kolor tekstu (również wybrany przez AI) jest nieczytelny, zmienia się na prawie czarny albo prawie biały.
- **AI** (`server/ai.ts`) wywołuje Claude przez oficjalne SDK `@anthropic-ai/sdk` ze *structured outputs*, więc odpowiedź to zawsze poprawny JSON zgodny ze schematem (`server/schema.ts`). Prompt zabrania wymyślania cen, dat i adresów, których nie ma w opisie. Włączone są serwerowe fallbacki (`fallbacks: "default"`): gdy model odmówi, zapytanie automatycznie przechodzi na model zapasowy.
- **Klucz API zostaje na serwerze.** Endpointy `/api/status`, `/api/generate` i `/api/refine` obsługuje wtyczka Vite (`server/plugin.ts`), która działa zarówno w `npm run dev`, jak i w `npm run preview`.
- **Eksport** (`src/lib/exportPng.ts`) renderuje podgląd przez `html-to-image` od razu w docelowej rozdzielczości. Elementy edytora (obramowania zaznaczenia, podpowiedzi) są pomijane.

```
src/
  model/        typy, silnik układu, generator offline, kolory, historia zmian (+ testy)
  components/   płótno z kafelkami, panel boczny
  lib/          dopasowanie tekstu, eksport PNG, API, zapis w przeglądarce, wzory SVG
server/         wywołania Claude, schemat odpowiedzi, wtyczka Vite z endpointami
```

## Co dalej

- Eksport MP4 z animacji kafelków (np. przez HyperFrames albo Remotion).
- Więcej formatów, np. okładka na Facebooka, LinkedIn, ulotka A5.
- Zestaw marki: logo, kolory i fonty zapamiętane dla całej firmy.
- Generowanie serii grafik z arkusza (np. osobny plakat dla każdego produktu).
- Angielska wersja interfejsu i samodzielny serwer do wdrożenia w internecie.
