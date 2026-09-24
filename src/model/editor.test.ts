import { describe, expect, it } from 'vitest';
import { createEditor, editorReducer } from './editor';
import type { Design } from './types';

const design: Design = {
  style: 'bold',
  seed: 0,
  palette: { bg: '#ffffff', surface: '#ffffff', ink: '#000000', accent: '#ff0000', accentInk: '#ffffff' },
  tiles: [
    { id: 'a', kind: 'headline', text: 'A', size: 'L', tone: 'clear' },
    { id: 'b', kind: 'text', text: 'B', size: 'M', tone: 'surface' },
    { id: 'c', kind: 'cta', text: 'C', size: 'S', tone: 'ink' },
  ],
};

describe('editorReducer', () => {
  it('swaps tiles and undoes/redoes', () => {
    let state = createEditor(design);
    state = editorReducer(state, { type: 'swapTiles', a: 'a', b: 'c' });
    expect(state.present.tiles.map((t) => t.id)).toEqual(['c', 'b', 'a']);
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.tiles.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    state = editorReducer(state, { type: 'redo' });
    expect(state.present.tiles.map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('merges consecutive typing into one undo step', () => {
    let state = createEditor(design);
    for (const text of ['H', 'He', 'Hej']) {
      state = editorReducer(state, { type: 'updateTile', id: 'a', patch: { text } });
    }
    expect(state.past).toHaveLength(1);
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.tiles[0].text).toBe('A');
  });

  it('ignores no-op actions', () => {
    const state = createEditor(design);
    expect(editorReducer(state, { type: 'moveTile', id: 'a', delta: -1 })).toBe(state);
    expect(editorReducer(state, { type: 'undo' })).toBe(state);
  });
});
