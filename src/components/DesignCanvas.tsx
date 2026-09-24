import { useDraggable, useDroppable } from '@dnd-kit/core';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fitText, useFontsVersion } from '../lib/fitText';
import { KINDS } from '../model/kinds';
import { layoutTiles } from '../model/layout';
import { paintTile } from '../model/paint';
import { STYLES } from '../model/themes';
import type { Design, Format, FormatId, Rect, Tile } from '../model/types';
import { tileRender } from '../render/tile';

export interface DragInfo {
  active: string | null;
  over: string | null;
}

interface DesignCanvasProps {
  design: Design;
  format: Format;
  selectedId: string | null;
  drag: DragInfo | null;
  animKey: number;
  onSelect: (id: string | null) => void;
  registerNode: (id: FormatId, node: HTMLDivElement | null) => void;
}

export function DesignCanvas({ design, format, selectedId, drag, animKey, onSelect, registerNode }: DesignCanvasProps) {
  const style = STYLES[design.style];
  const [size, setSize] = useState({ w: 0, h: 0 });
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const setNode = useCallback(
    (node: HTMLDivElement | null) => {
      nodeRef.current = node;
      registerNode(format.id, node);
    },
    [format.id, registerNode],
  );

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The layout only depends on which tiles exist and how big they are, not on their text.
  const layoutKey = design.tiles.map((t) => `${t.id}:${t.kind}:${t.size}`).join('|');
  const rects = useMemo(
    () =>
      layoutTiles(design.tiles, {
        width: format.width,
        height: format.height,
        padding: style.padding,
        gap: style.gap,
        seed: design.seed,
      }),
    [layoutKey, format.width, format.height, style, design.seed],
  );

  return (
    <div
      ref={setNode}
      className="canvas"
      style={{ background: design.palette.bg, aspectRatio: `${format.width} / ${format.height}` }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      {size.w > 0 &&
        design.tiles.map((tile, index) => {
          const rect = rects[tile.id];
          if (!rect) return null;
          return (
            <TileView
              key={`${tile.id}:${animKey}`}
              tile={tile}
              rect={rect}
              canvasW={size.w}
              canvasH={size.h}
              design={design}
              formatId={format.id}
              index={index}
              selected={tile.id === selectedId}
              dragging={drag?.active === tile.id}
              over={drag?.over === tile.id && drag.active !== tile.id}
              animate={animKey > 0}
              onSelect={onSelect}
            />
          );
        })}
    </div>
  );
}

interface TileViewProps {
  tile: Tile;
  rect: Rect;
  canvasW: number;
  canvasH: number;
  design: Design;
  formatId: FormatId;
  index: number;
  selected: boolean;
  dragging: boolean;
  over: boolean;
  animate: boolean;
  onSelect: (id: string) => void;
}

const TileView = memo(function TileView(props: TileViewProps) {
  const { tile, rect, canvasW, canvasH, design, formatId, index, selected, dragging, over, animate, onSelect } = props;
  const spec = KINDS[tile.kind];
  const view = tileRender(tile, rect, canvasW, canvasH, design);
  const { font } = view;

  const dndId = `${formatId}::${tile.id}`;
  const draggable = useDraggable({ id: dndId, data: { tileId: tile.id } });
  const droppable = useDroppable({ id: dndId, data: { tileId: tile.id } });
  const { setNodeRef: setDragRef } = draggable;
  const { setNodeRef: setDropRef } = droppable;
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  const textRef = useRef<HTMLDivElement>(null);
  const fontsVersion = useFontsVersion();
  useLayoutEffect(() => {
    if (textRef.current) fitText(textRef.current, view.boxW, view.boxH, view.maxFontPx);
  }, [view.text, view.boxW, view.boxH, view.maxFontPx, font.family, font.weight, font.transform, font.letterSpacing, font.lineHeight, fontsVersion]);

  const className = [
    'tile',
    `tile--${tile.kind}`,
    selected && 'is-selected',
    dragging && 'is-dragging',
    over && 'is-over',
    animate && 'is-entering',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setRef}
      {...draggable.attributes}
      {...draggable.listeners}
      aria-label={`${spec.label}: ${tile.text || spec.hint}`}
      className={className}
      style={
        {
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
          backgroundColor: view.paint.background,
          backgroundImage: view.backgroundImage,
          color: view.paint.color,
          borderRadius: view.radius,
          boxShadow: view.boxShadow,
          '--i': index,
        } as CSSProperties
      }
      onClick={(event) => {
        event.stopPropagation();
        onSelect(tile.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(tile.id);
        }
      }}
    >
      {view.logo && <div className="tile__logo" style={{ inset: view.pad, backgroundImage: `url("${view.logo}")` }} />}
      {view.text && (
        <div className="tile__box" style={{ inset: view.pad, justifyContent: font.justify }}>
          <div
            ref={textRef}
            className="tile__text"
            style={{
              fontFamily: font.family,
              fontWeight: font.weight,
              textAlign: font.align,
              textTransform: font.transform,
              letterSpacing: font.letterSpacing,
              lineHeight: font.lineHeight,
            }}
          >
            {view.text}
          </div>
        </div>
      )}
      {tile.kind === 'image' && !tile.image && (
        <div className="tile__hint" data-editor-only="">
          + zdjęcie
        </div>
      )}
      <div className="tile__ring" data-editor-only="" style={{ borderRadius: view.radius }} />
    </div>
  );
});

/** Lightweight stand-in that follows the pointer while a tile is dragged. */
export function TileGhost({ tile, design }: { tile: Tile; design: Design }) {
  const paint = paintTile(tile, design.palette);
  const spec = KINDS[tile.kind];
  return (
    <div
      className="tile-ghost"
      style={{
        background: paint.background === 'transparent' ? design.palette.bg : paint.background,
        color: paint.color,
      }}
    >
      <span>{tile.kind === 'image' ? spec.label : tile.text || spec.label}</span>
    </div>
  );
}
