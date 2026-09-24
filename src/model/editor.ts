import type { Design, Palette, StyleId, Tile } from './types';

export type EditorAction =
  | { type: 'replace'; design: Design }
  | { type: 'updateTile'; id: string; patch: Partial<Omit<Tile, 'id'>> }
  | { type: 'swapTiles'; a: string; b: string }
  | { type: 'moveTile'; id: string; delta: -1 | 1 }
  | { type: 'addTile'; tile: Tile }
  | { type: 'removeTile'; id: string }
  | { type: 'setStyle'; style: StyleId }
  | { type: 'setPalette'; palette: Palette }
  | { type: 'nextLayout' }
  | { type: 'undo' }
  | { type: 'redo' };

export interface EditorState {
  past: Design[];
  present: Design;
  future: Design[];
  /** Typing into one tile within `COALESCE_MS` is one undo step, not one per keystroke. */
  lastEdit: { key: string; at: number } | null;
}

const HISTORY_LIMIT = 80;
const COALESCE_MS = 1200;

export function createEditor(design: Design): EditorState {
  return { past: [], present: design, future: [], lastEdit: null };
}

function applyAction(design: Design, action: EditorAction): Design {
  switch (action.type) {
    case 'replace':
      return action.design;
    case 'updateTile':
      return {
        ...design,
        tiles: design.tiles.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };
    case 'swapTiles': {
      const ia = design.tiles.findIndex((t) => t.id === action.a);
      const ib = design.tiles.findIndex((t) => t.id === action.b);
      if (ia < 0 || ib < 0 || ia === ib) return design;
      const tiles = [...design.tiles];
      [tiles[ia], tiles[ib]] = [tiles[ib], tiles[ia]];
      return { ...design, tiles };
    }
    case 'moveTile': {
      const i = design.tiles.findIndex((t) => t.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= design.tiles.length) return design;
      const tiles = [...design.tiles];
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      return { ...design, tiles };
    }
    case 'addTile':
      return { ...design, tiles: [...design.tiles, action.tile] };
    case 'removeTile':
      return { ...design, tiles: design.tiles.filter((t) => t.id !== action.id) };
    case 'setStyle':
      return { ...design, style: action.style };
    case 'setPalette':
      return { ...design, palette: action.palette };
    case 'nextLayout':
      return { ...design, seed: design.seed + 1 };
    case 'undo':
    case 'redo':
      return design;
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      lastEdit: null,
    };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    return {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1),
      lastEdit: null,
    };
  }

  const present = applyAction(state.present, action);
  if (present === state.present) return state;

  const now = Date.now();
  const key = action.type === 'updateTile' && 'text' in action.patch ? `text:${action.id}` : null;
  const coalesce = key !== null && state.lastEdit?.key === key && now - state.lastEdit.at < COALESCE_MS;

  return {
    past: coalesce ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    lastEdit: key ? { key, at: now } : null,
  };
}
