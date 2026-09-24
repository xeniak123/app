import { useState, type Dispatch } from 'react';
import type { AiStatus } from '../lib/api';
import { readImage } from '../lib/image';
import type { EditorAction } from '../model/editor';
import { KINDS, SIZE_LABEL, TONE_LABEL } from '../model/kinds';
import { makeTile } from '../model/offline';
import { paintTile } from '../model/paint';
import { MAX_TILES } from '../model/sanitize';
import { PALETTES, STYLES } from '../model/themes';
import { STYLE_IDS, TILE_KINDS, TILE_SIZES, TILE_TONES, type Design, type Palette, type Tile } from '../model/types';

export type Busy = 'generate' | 'refine' | 'export' | null;

export const EXAMPLES = [
  {
    label: '🍕 Pizzeria',
    text: 'Pizzeria Roma – w każdy piątek -30% na wszystkie pizze! Zamów na roma.pl, ul. Długa 5, Kraków',
  },
  {
    label: '🎵 Koncert',
    text: 'Koncert jazzowy pod gwiazdami. Wstęp wolny! Sobota 20:00, Park Miejski. Rezerwuj miejsce na jazzwparku.pl',
  },
  {
    label: '☕ Kawiarnia',
    text: 'Otwieramy kawiarnię Ziarno! Pierwsza kawa gratis. 12.10 od 8:00, ul. Polna 3',
  },
  {
    label: '🎓 Kurs',
    text: 'Kurs programowania dla początkujących – 8 tygodni nauki od zera. Tylko 499 zł. Zapisz się na kodujzami.pl',
  },
];

const QUICK_EMOJIS = ['🔥', '✨', '🎉', '🍕', '☕', '🎵', '💪', '📚', '🚀', '❤️', '🌿', '🎁'];

interface SidebarProps {
  brief: string;
  onBriefChange: (brief: string) => void;
  ai: AiStatus | null;
  busy: Busy;
  onGenerate: () => void;
  onRefine: (instruction: string) => Promise<boolean>;
  design: Design;
  dispatch: Dispatch<EditorAction>;
  selectedTile: Tile | null;
  onSelect: (id: string | null) => void;
  onAnimate: () => void;
  onError: (message: string) => void;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sidebar">
      <BriefPanel {...props} />
      <LookPanel design={props.design} dispatch={props.dispatch} onAnimate={props.onAnimate} />
      <TilesPanel {...props} />
    </aside>
  );
}

function BriefPanel({ brief, onBriefChange, ai, busy, onGenerate, onRefine }: SidebarProps) {
  const [instruction, setInstruction] = useState('');
  const aiOn = Boolean(ai?.ai);
  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="step">1</span> Co tworzysz?
      </h2>
      <textarea
        className="input"
        rows={4}
        value={brief}
        placeholder="Opisz wydarzenie, promocję albo produkt: co, kiedy, gdzie, za ile…"
        onChange={(e) => onBriefChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onGenerate();
        }}
      />
      <div className="chips">
        {EXAMPLES.map((example) => (
          <button key={example.label} className="chip" type="button" onClick={() => onBriefChange(example.text)}>
            {example.label}
          </button>
        ))}
      </div>
      <button className="btn btn--primary btn--wide" type="button" onClick={onGenerate} disabled={busy !== null}>
        {busy === 'generate' ? 'AI projektuje…' : aiOn ? '✦ Zaprojektuj z AI' : '✦ Zaprojektuj'}
      </button>
      <p className="note">
        {ai === null
          ? 'Sprawdzam połączenie z AI…'
          : aiOn
            ? `Projektuje ${ai.model}. Ctrl + Enter też działa.`
            : 'Tryb offline: projekt powstaje z prostych reguł. Dodaj ANTHROPIC_API_KEY w pliku .env, żeby projektowało AI.'}
      </p>

      <form
        className="refine"
        onSubmit={async (e) => {
          e.preventDefault();
          if (instruction.trim() && (await onRefine(instruction.trim()))) setInstruction('');
        }}
      >
        <input
          className="input"
          value={instruction}
          disabled={!aiOn || busy !== null}
          placeholder={aiOn ? 'Poproś AI: „bardziej elegancko”, „dodaj godziny 12–22”…' : 'Wymaga klucza API'}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!aiOn || busy !== null || !instruction.trim()}>
          {busy === 'refine' ? '…' : 'Zmień'}
        </button>
      </form>
    </section>
  );
}

function samePalette(a: Palette, b: Palette) {
  return a.bg === b.bg && a.surface === b.surface && a.ink === b.ink && a.accent === b.accent && a.accentInk === b.accentInk;
}

const COLOR_FIELDS: { key: keyof Palette; label: string }[] = [
  { key: 'bg', label: 'Tło' },
  { key: 'surface', label: 'Karty' },
  { key: 'ink', label: 'Tekst' },
  { key: 'accent', label: 'Akcent' },
  { key: 'accentInk', label: 'Tekst na akcencie' },
];

function LookPanel({
  design,
  dispatch,
  onAnimate,
}: {
  design: Design;
  dispatch: Dispatch<EditorAction>;
  onAnimate: () => void;
}) {
  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="step">2</span> Wygląd
      </h2>
      <div className="styles">
        {STYLE_IDS.map((id) => {
          const spec = STYLES[id];
          return (
            <button
              key={id}
              type="button"
              className="style-option"
              aria-pressed={design.style === id}
              onClick={() => dispatch({ type: 'setStyle', style: id })}
            >
              <span
                className="style-option__sample"
                style={{
                  fontFamily: spec.display,
                  fontWeight: spec.displayWeight,
                  textTransform: spec.uppercase ? 'uppercase' : 'none',
                }}
              >
                Aa
              </span>
              <span className="style-option__label">{spec.label}</span>
            </button>
          );
        })}
      </div>
      <div className="swatches" role="group" aria-label="Palety kolorów">
        {PALETTES.map((palette) => (
          <button
            key={palette.name}
            type="button"
            className="swatch"
            title={palette.name}
            aria-label={`Paleta ${palette.name}`}
            aria-pressed={samePalette(palette, design.palette)}
            onClick={() => {
              const { name: _name, ...colors } = palette;
              dispatch({ type: 'setPalette', palette: colors });
            }}
          >
            <span style={{ background: palette.bg }} />
            <span style={{ background: palette.accent }} />
            <span style={{ background: palette.ink }} />
          </button>
        ))}
      </div>
      <details className="custom-colors">
        <summary>Własne kolory</summary>
        <div className="color-fields">
          {COLOR_FIELDS.map(({ key, label }) => (
            <label key={key} className="color-field">
              <input
                type="color"
                value={design.palette[key]}
                onChange={(e) => dispatch({ type: 'setPalette', palette: { ...design.palette, [key]: e.target.value } })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </details>
      <div className="row">
        <button className="btn" type="button" onClick={() => dispatch({ type: 'nextLayout' })}>
          ⟳ Inny układ
        </button>
        <button className="btn" type="button" onClick={onAnimate}>
          ▶ Animuj
        </button>
      </div>
    </section>
  );
}

function TilesPanel({ design, dispatch, selectedTile, onSelect, onError }: SidebarProps) {
  const full = design.tiles.length >= MAX_TILES;
  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="step">3</span> Kafelki
      </h2>
      {selectedTile ? (
        <TileInspector
          key={selectedTile.id}
          tile={selectedTile}
          design={design}
          dispatch={dispatch}
          onSelect={onSelect}
          onError={onError}
        />
      ) : (
        <p className="note">
          Kliknij kafelek, żeby go edytować. <strong>Przeciągnij kafelek na inny</strong>, żeby zamienić je miejscami.
          Zmiana od razu pojawi się we wszystkich formatach.
        </p>
      )}
      <div className="add">
        <span className="add__label">Dodaj kafelek{full ? ` (limit ${MAX_TILES})` : ''}:</span>
        <div className="chips">
          {TILE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="chip"
              disabled={full}
              onClick={() => {
                const tile = makeTile(kind, KINDS[kind].placeholder);
                dispatch({ type: 'addTile', tile });
                onSelect(tile.id);
              }}
            >
              + {KINDS[kind].label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function TileInspector({
  tile,
  design,
  dispatch,
  onSelect,
  onError,
}: {
  tile: Tile;
  design: Design;
  dispatch: Dispatch<EditorAction>;
  onSelect: (id: string | null) => void;
  onError: (message: string) => void;
}) {
  const spec = KINDS[tile.kind];
  const update = (patch: Partial<Omit<Tile, 'id'>>) => dispatch({ type: 'updateTile', id: tile.id, patch });
  const index = design.tiles.findIndex((t) => t.id === tile.id);

  return (
    <div className="inspector">
      <div className="inspector__head">
        <label className="field field--inline">
          <span>Rodzaj</span>
          <select className="input" value={tile.kind} onChange={(e) => update({ kind: e.target.value as Tile['kind'] })}>
            {TILE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KINDS[kind].label} – {KINDS[kind].hint}
              </option>
            ))}
          </select>
        </label>
        <button className="icon-btn" type="button" aria-label="Zamknij edycję kafelka" onClick={() => onSelect(null)}>
          ×
        </button>
      </div>

      {tile.kind !== 'image' && !(tile.kind === 'brand' && tile.image) && (
        <label className="field">
          <span>Treść</span>
          <textarea
            className="input"
            rows={tile.kind === 'emoji' ? 1 : 3}
            value={tile.text}
            placeholder={spec.placeholder}
            onChange={(e) => update({ text: e.target.value })}
          />
        </label>
      )}

      {tile.kind === 'emoji' && (
        <div className="emoji-row">
          {QUICK_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" className="emoji-btn" onClick={() => update({ text: emoji })}>
              {emoji}
            </button>
          ))}
        </div>
      )}

      {(tile.kind === 'image' || tile.kind === 'brand') && (
        <div className="row">
          <label className="btn">
            {tile.image ? 'Zmień' : 'Dodaj'} {tile.kind === 'image' ? 'zdjęcie' : 'logo'}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  update({ image: await readImage(file) });
                } catch (error) {
                  onError(error instanceof Error ? error.message : 'Nie udało się wczytać obrazu.');
                }
              }}
            />
          </label>
          {tile.image && (
            <button className="btn" type="button" onClick={() => update({ image: undefined })}>
              Usuń {tile.kind === 'image' ? 'zdjęcie' : 'logo'}
            </button>
          )}
        </div>
      )}

      <div className="field">
        <span>Rozmiar</span>
        <div className="segmented">
          {TILE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              title={SIZE_LABEL[size]}
              aria-pressed={tile.size === size}
              onClick={() => update({ size })}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Tło kafelka</span>
        <div className="segmented">
          {TILE_TONES.map((tone) => {
            const paint = paintTile({ kind: tile.kind, tone }, design.palette);
            return (
              <button key={tone} type="button" aria-pressed={tile.tone === tone} onClick={() => update({ tone })}>
                <i
                  className="tone-dot"
                  style={{ background: paint.background === 'transparent' ? design.palette.bg : paint.background }}
                />
                {TONE_LABEL[tone]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="row">
        <button
          className="btn"
          type="button"
          disabled={index <= 0}
          onClick={() => dispatch({ type: 'moveTile', id: tile.id, delta: -1 })}
        >
          ← Wcześniej
        </button>
        <button
          className="btn"
          type="button"
          disabled={index >= design.tiles.length - 1}
          onClick={() => dispatch({ type: 'moveTile', id: tile.id, delta: 1 })}
        >
          Później →
        </button>
        <button
          className="btn btn--danger"
          type="button"
          onClick={() => {
            dispatch({ type: 'removeTile', id: tile.id });
            onSelect(null);
          }}
        >
          Usuń
        </button>
      </div>
    </div>
  );
}
