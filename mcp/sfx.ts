/**
 * Sound effects bundled with the server: CC0 recordings by Kenney
 * (https://kenney.nl), the same library the /brag skill uses. Loudness and
 * brightness notes follow brag's analysis of these files.
 */

const files = import.meta.glob('./assets/sfx/*.ogg', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;

export interface SoundEffect {
  name: string;
  seconds: number;
  character: string;
  use: string;
}

export const SOUND_EFFECTS: SoundEffect[] = [
  { name: 'soft-hit', seconds: 0.12, character: 'warm soft thud, low harshness', use: 'headline landing, hard cut, major reveal' },
  { name: 'soft-hit-2', seconds: 0.18, character: 'warm soft thud, a little longer', use: 'major reveal, scene change' },
  { name: 'soft-hit-3', seconds: 0.14, character: 'warm soft thud, textured', use: 'second hit in a sequence, card landing' },
  { name: 'bell-ring', seconds: 1.48, character: 'deep resonant bell with a long ring', use: 'logo payoff, final reveal (once per video)' },
  { name: 'bell-short', seconds: 0.3, character: 'deep bell, short', use: 'success, confirmation, price or date reveal' },
  { name: 'bong', seconds: 0.12, character: 'warm, rounded bong', use: 'gentle accent, list item, polished tones' },
  { name: 'click', seconds: 0.01, character: 'crisp click, low harshness', use: 'button press, cursor click, selection' },
  { name: 'click-2', seconds: 0.01, character: 'crisp click, slightly different', use: 'alternate with click for repeated presses' },
  { name: 'tap', seconds: 0.06, character: 'soft UI tap', use: 'typing accents, toggles, small UI moments' },
  { name: 'rollover', seconds: 0.06, character: 'soft UI blip', use: 'hover, focus, small highlight' },
  { name: 'switch', seconds: 0.61, character: 'toggle switch', use: 'feature switching on, before/after' },
  { name: 'drop', seconds: 0.19, character: 'soft drop', use: 'element settling into place, gentle placement' },
  { name: 'card-slide', seconds: 0.6, character: 'paper slide, medium brightness', use: 'card or panel sliding in, swipe' },
  { name: 'card-place', seconds: 0.69, character: 'card placed down, bright', use: 'card sequence, deal-in (keep quiet)' },
  { name: 'chips', seconds: 0.29, character: 'stacking chips, bright', use: 'counter ticking up, stats, money (keep quiet)' },
  { name: 'glitch', seconds: 0.03, character: 'tiny digital glitch', use: 'tech or AI moment, chaotic accent, tiny only' },
];

export function soundEffectFile(name: string): Buffer | null {
  const dataUrl = files[`./assets/sfx/${name}.ogg`];
  if (!dataUrl) return null;
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}
