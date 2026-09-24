import { useDraggable, useDroppable } from '@dnd-kit/core';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fitText, useFontsVersion } from '../lib/fitText';
import { patternUrl } from '../lib/patterns';
import { KINDS } from '../model/kinds';
import { hashString, layoutTiles } from '../model/layout';
import { paintTile } from '../model/paint';
import { STYLES, type StyleSpec } from '../model/themes';
import type { Design, Format, FormatId, Rect, Tile, TileKind } from '../model/types';

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const ALIGN: Record<TileKind, { justify: CSSProperties['justifyContent']; text: 'left' | 'center' }> = {
  headline: { justify: 'flex-end', text: 'left' },
  text: { justify: 'flex-start', text: 'left' },
  number: { justify: 'center', text: 'center' },
  cta: { justify: 'center', text: 'center' },
  info: { justify: 'flex-end', text: 'left' },
  image: { justify: 'flex-end', text: 'left' },
  emoji: { justify: 'center', text: 'center' },
  brand: { justify: 'center', text: 'left' },
};

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
              style={style}
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
  style: StyleSpec;
  formatId: FormatId;
  index: number;
  selected: boolean;
  dragging: boolean;
  over: boolean;
  animate: boolean;
  onSelect: (id: string) => void;
}

const TileView = memo(function TileView(props: TileViewProps) {
  const { tile, rect, canvasW, canvasH, design, style, formatId, index, selected, dragging, over, animate, onSelect } =
    props;
  const spec = KINDS[tile.kind];
  const paint = paintTile(tile, design.palette);

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

  const shorter = Math.min(canvasW, canvasH);
  const w = rect.w * canvasW;
  const h = rect.h * canvasH;
  const pad = Math.min(style.tilePadding * shorter, Math.min(w, h) * 0.18);
  const boxW = Math.max(w - 2 * pad, 1);
  const boxH = Math.max(h - 2 * pad, 1);
  const radius = Math.min(style.radius * shorter, Math.min(w, h) * 0.3);

  const isDisplay = spec.font === 'display';
  const fontFamily = spec.font === 'emoji' ? EMOJI_FONT : isDisplay ? style.display : style.body;
  const fontWeight = isDisplay ? style.displayWeight : tile.kind === 'cta' ? 600 : style.bodyWeight;
  const showLogo = tile.kind === 'brand' && Boolean(tile.image);
  const text = showLogo ? '' : tile.text;

  const textRef = useRef<HTMLDivElement>(null);
  const fontsVersion = useFontsVersion();
  useLayoutEffect(() => {
    if (textRef.current) fitText(textRef.current, boxW, boxH, spec.maxFont * shorter);
  }, [text, boxW, boxH, fontFamily, fontWeight, style, spec.maxFont, shorter, fontsVersion]);

  let backgroundImage: string | undefined;
  if (tile.kind === 'image') {
    backgroundImage = tile.image
      ? `url("${tile.image}")`
      : patternUrl(
          design.style,
          paint.background === 'transparent' ? design.palette.bg : paint.background,
          paint.color,
          hashString(tile.id),
        );
  }

  const align = ALIGN[tile.kind];
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
          backgroundColor: paint.background,
          backgroundImage,
          color: paint.color,
          borderRadius: radius,
          boxShadow: paint.border ? `inset 0 0 0 ${Math.max(1, shorter * 0.002)}px ${paint.border}` : undefined,
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
      {showLogo && (
        <div className="tile__logo" style={{ inset: pad, backgroundImage: `url("${tile.image}")` }} />
      )}
      {text && (
        <div className="tile__box" style={{ inset: pad, justifyContent: align.justify }}>
          <div
            ref={textRef}
            className="tile__text"
            style={{
              fontFamily,
              fontWeight,
              textAlign: align.text,
              textTransform: isDisplay && style.uppercase && tile.kind !== 'brand' ? 'uppercase' : 'none',
              letterSpacing: isDisplay ? style.letterSpacing : '0',
              lineHeight: isDisplay ? style.lineHeight : 1.25,
            }}
          >
            {text}
          </div>
        </div>
      )}
      {tile.kind === 'image' && !tile.image && (
        <div className="tile__hint" data-editor-only="">
          + zdjęcie
        </div>
      )}
      <div className="tile__ring" data-editor-only="" style={{ borderRadius: radius }} />
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
