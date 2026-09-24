import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { DesignCanvas, TileGhost, type DragInfo } from './components/DesignCanvas';
import { EXAMPLES, Sidebar, type Busy } from './components/Sidebar';
import { fetchStatus, requestGenerate, requestRefine, type AiStatus } from './lib/api';
import { exportPngs } from './lib/exportPng';
import { FontsVersionContext, useFontsVersionSource } from './lib/fitText';
import { loadProject, saveProject } from './lib/storage';
import { createEditor, editorReducer } from './model/editor';
import { FORMATS, getFormat } from './model/formats';
import { designFromBrief } from './model/offline';
import { slugify } from './model/slug';
import type { Design, FormatId } from './model/types';

type View = 'all' | FormatId;

interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

function initialProject() {
  const saved = loadProject();
  if (saved) return saved;
  const brief = EXAMPLES[0].text;
  return { brief, design: designFromBrief(brief) };
}

/** Keeps the user's uploaded photo and logo when a brand-new design is generated. */
function carryImages(previous: Design, next: Design): Design {
  const tiles = [...next.tiles];
  for (const kind of ['image', 'brand'] as const) {
    const source = previous.tiles.find((t) => t.kind === kind && t.image);
    const targetIndex = tiles.findIndex((t) => t.kind === kind && !t.image);
    if (source && targetIndex >= 0) tiles[targetIndex] = { ...tiles[targetIndex], image: source.image };
  }
  return { ...next, tiles };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

export function App() {
  const [initial] = useState(initialProject);
  const [editor, dispatch] = useReducer(editorReducer, initial.design, createEditor);
  const design = editor.present;
  const [brief, setBrief] = useState(initial.brief);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [animKey, setAnimKey] = useState(0);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const fontsVersion = useFontsVersionSource();
  const canvasNodes = useRef(new Map<FormatId, HTMLDivElement>());
  const storageWarned = useRef(false);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    setToast({ id: Date.now(), kind, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void fetchStatus().then(setAi);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const ok = saveProject({ design, brief });
      if (!ok && !storageWarned.current) {
        storageWarned.current = true;
        notify('Projekt jest za duży, żeby zapisać go w przeglądarce (zdjęcia). Pobierz PNG, zanim zamkniesz kartę.', 'error');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [design, brief, notify]);

  const selectedTile = design.tiles.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        dispatch({ type: 'removeTile', id: selectedId });
        setSelectedId(null);
      } else if (event.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const registerNode = useCallback((id: FormatId, node: HTMLDivElement | null) => {
    if (node) canvasNodes.current.set(id, node);
    else canvasNodes.current.delete(id);
  }, []);

  const applyNewDesign = (next: Design) => {
    dispatch({ type: 'replace', design: carryImages(design, next) });
    setSelectedId(null);
    setAnimKey((k) => k + 1);
  };

  const generate = async () => {
    if (busy !== null) return;
    const text = brief.trim();
    if (!text) {
      notify('Najpierw opisz, co chcesz stworzyć.', 'error');
      return;
    }
    if (!ai?.ai) {
      applyNewDesign(designFromBrief(text));
      return;
    }
    setBusy('generate');
    try {
      applyNewDesign(await requestGenerate(text));
    } catch (error) {
      applyNewDesign(designFromBrief(text));
      notify(`${error instanceof Error ? error.message : 'AI jest niedostępne.'} Użyłem trybu offline.`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const refine = async (instruction: string): Promise<boolean> => {
    setBusy('refine');
    try {
      dispatch({ type: 'replace', design: await requestRefine(design, instruction) });
      setAnimKey((k) => k + 1);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Nie udało się zmienić projektu.', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const exportFormats = async (ids: FormatId[]) => {
    setBusy('export');
    try {
      if (view !== 'all' && ids.some((id) => id !== view)) {
        setView('all');
        await nextFrame();
        await nextFrame();
      }
      await document.fonts?.ready;
      const targets = ids.flatMap((id) => {
        const node = canvasNodes.current.get(id);
        return node ? [{ format: getFormat(id), node }] : [];
      });
      const headline = design.tiles.find((t) => t.kind === 'headline')?.text ?? 'tilecast';
      await exportPngs(targets, slugify(headline));
      notify(targets.length > 1 ? `Zapisano ${targets.length} pliki PNG.` : 'Zapisano PNG.');
    } catch (error) {
      console.error(error);
      notify('Nie udało się zapisać PNG. Spróbuj ponownie.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const tileIdOf = (data: unknown) => (data as { tileId?: string } | undefined)?.tileId ?? null;
  const onDragStart = (event: DragStartEvent) => {
    const id = tileIdOf(event.active.data.current);
    setDrag({ active: id, over: null });
    setSelectedId(id);
  };
  const onDragOver = (event: DragOverEvent) => {
    const over = tileIdOf(event.over?.data.current);
    setDrag((d) => (d && d.over !== over ? { ...d, over } : d));
  };
  const onDragEnd = (event: DragEndEvent) => {
    const a = tileIdOf(event.active.data.current);
    const b = tileIdOf(event.over?.data.current);
    if (a && b && a !== b) dispatch({ type: 'swapTiles', a, b });
    setDrag(null);
  };
  const draggedTile = drag?.active ? design.tiles.find((t) => t.id === drag.active) : undefined;

  const visibleFormats = view === 'all' ? FORMATS : FORMATS.filter((f) => f.id === view);

  return (
    <FontsVersionContext.Provider value={fontsVersion}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="brand__name">Tilecast</span>
            <span className="brand__tagline">Jedna treść, każdy format</span>
          </div>
          <div className="topbar__actions">
            <button
              className="icon-btn"
              type="button"
              title="Cofnij (Ctrl+Z)"
              aria-label="Cofnij"
              disabled={editor.past.length === 0}
              onClick={() => dispatch({ type: 'undo' })}
            >
              ↶
            </button>
            <button
              className="icon-btn"
              type="button"
              title="Ponów (Ctrl+Shift+Z)"
              aria-label="Ponów"
              disabled={editor.future.length === 0}
              onClick={() => dispatch({ type: 'redo' })}
            >
              ↷
            </button>
            <div className="views" role="tablist" aria-label="Widok">
              <button type="button" role="tab" aria-selected={view === 'all'} onClick={() => setView('all')}>
                Wszystkie
              </button>
              {FORMATS.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  role="tab"
                  aria-selected={view === format.id}
                  onClick={() => setView(format.id)}
                >
                  {format.label}
                </button>
              ))}
            </div>
            <button
              className="btn btn--primary"
              type="button"
              disabled={busy !== null}
              onClick={() => exportFormats(FORMATS.map((f) => f.id))}
            >
              {busy === 'export' ? 'Zapisuję…' : '↓ Pobierz wszystkie PNG'}
            </button>
          </div>
        </header>

        <div className="workspace">
          <Sidebar
            brief={brief}
            onBriefChange={setBrief}
            ai={ai}
            busy={busy}
            onGenerate={generate}
            onRefine={refine}
            design={design}
            dispatch={dispatch}
            selectedTile={selectedTile}
            onSelect={setSelectedId}
            onAnimate={() => setAnimKey((k) => k + 1)}
            onError={(message) => notify(message, 'error')}
          />

          <main className={`board ${view === 'all' ? 'board--all' : 'board--single'}`} aria-busy={busy !== null}>
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={() => setDrag(null)}
            >
              {visibleFormats.map((format) => (
                <section
                  key={format.id}
                  className="format-card"
                  style={{ '--ratio': format.width / format.height } as CSSProperties}
                >
                  <header className="format-card__head">
                    <div>
                      <h3>{format.label}</h3>
                      <span>
                        {format.width}×{format.height} · {format.note}
                      </span>
                    </div>
                    <button
                      className="btn btn--small"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => exportFormats([format.id])}
                    >
                      ↓ PNG
                    </button>
                  </header>
                  <DesignCanvas
                    design={design}
                    format={format}
                    selectedId={selectedId}
                    drag={drag}
                    animKey={animKey}
                    onSelect={setSelectedId}
                    registerNode={registerNode}
                  />
                </section>
              ))}
              <DragOverlay dropAnimation={null}>
                {draggedTile ? <TileGhost tile={draggedTile} design={design} /> : null}
              </DragOverlay>
            </DndContext>
          </main>
        </div>

        {busy === 'generate' || busy === 'refine' ? (
          <div className="busy-veil" role="status">
            <span className="busy-veil__dot" /> AI układa kafelki…
          </div>
        ) : null}
        {toast && (
          <div key={toast.id} className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            {toast.text}
          </div>
        )}
      </div>
    </FontsVersionContext.Provider>
  );
}
