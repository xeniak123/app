/**
 * Script injected into every composition before its own scripts run.
 *
 * - Registers the bundled fonts the composition uses.
 * - Replaces the clock (performance.now, Date, requestAnimationFrame, timers)
 *   with virtual time, so any frame can be rendered as a pure function of time.
 * - `__tilecast.seek(t)` places every CSS animation, transition and Web
 *   Animation, rAF loop, timer, <video> and `tilecast.onFrame()` hook at time t.
 * - Audit helpers that describe the text on screen for the design critic.
 *
 * The function is serialised with toString(), so it must not reference
 * anything outside its own body.
 */

export interface RuntimeFont {
  family: string;
  src: string;
  weight: string;
  style: string;
  unicodeRange: string;
}

export interface TextInfo {
  key: string;
  desc: string;
  text: string;
  words: number;
  /** x, y, width, height of the rendered text, in CSS pixels. */
  rect: [number, number, number, number];
  /** Corners (top-left, top-right, bottom-right, bottom-left) when the element is rotated or skewed. */
  quad: [number, number][] | null;
  /** Effective opacity: ancestors' opacity, visibility, and how much of it other opaque elements cover. */
  opacity: number;
  /** Share of the text inside the canvas, 0..1. */
  inside: number;
  /** 'self' when the element's own overflow cuts its text, else the clipping ancestor. */
  clippedBy: string | null;
  color: string;
  /** Every text color inside the block (highlighted words, links). */
  colors: string[];
  fontSize: number;
  fontWeight: number;
  family: string;
}

export interface AuditResult {
  width: number;
  height: number;
  texts: TextInfo[];
  brokenImages: string[];
  missingFonts: string[];
  external: string[];
  errors: string[];
}

export interface AudioTrack {
  src: string;
  start: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  trim: number;
  duration: number | null;
  loop: boolean;
}

export interface CompositionInfo {
  title: string;
  duration: number | null;
  fps: number | null;
  poster: number | null;
  scenes: number[];
  audio: AudioTrack[];
  /** When the last finite animation ends, in seconds. */
  animationEnd: number;
  animations: number;
  hooks: number;
}

/** [key, words, opacity, inside, x, y, width, height, text, fontSize] */
export type TextSample = [string, number, number, number, number, number, number, number, string, number];

function tilecastRuntime(config: { fonts: RuntimeFont[] }) {
  const w = window as any;
  if (w.__tilecast) return;

  for (const font of config.fonts) {
    try {
      document.fonts.add(
        new FontFace(font.family, `url(${font.src}) format("woff2")`, {
          weight: font.weight,
          style: font.style,
          unicodeRange: font.unicodeRange,
        }),
      );
    } catch {
      // An invalid face should not break the composition.
    }
  }

  // ---- virtual time -------------------------------------------------------
  const realRaf = window.requestAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const RealDate = Date;
  const epoch = RealDate.UTC(2026, 0, 1, 12);
  let now = 0;
  let lastSeek = 0;
  const rafs = new Map<number, FrameRequestCallback>();
  let rafSeq = 0;
  type Timer = { id: number; at: number; cb: (...args: unknown[]) => void; args: unknown[]; every?: number };
  let timers: Timer[] = [];
  let timerSeq = 0;
  const born = new WeakMap<Animation, number>();
  const hooks: ((t: number) => unknown)[] = [];
  const errors: string[] = [];
  const note = (error: unknown) => {
    if (errors.length < 50) errors.push(String((error as Error)?.message ?? error));
  };

  Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
  function FakeDate(this: unknown, ...args: unknown[]) {
    if (!(this instanceof FakeDate)) return new RealDate(epoch + now).toString();
    return args.length ? new (RealDate as any)(...args) : new RealDate(epoch + now);
  }
  FakeDate.prototype = RealDate.prototype;
  (FakeDate as any).now = () => epoch + now;
  (FakeDate as any).parse = RealDate.parse;
  (FakeDate as any).UTC = RealDate.UTC;
  w.Date = FakeDate;

  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafs.set(++rafSeq, cb);
    return rafSeq;
  };
  w.cancelAnimationFrame = (id: number) => rafs.delete(id);
  w.setTimeout = (cb: unknown, ms?: number, ...args: unknown[]) => {
    const id = ++timerSeq;
    if (typeof cb === 'function') timers.push({ id, at: now + Math.max(0, Number(ms) || 0), cb: cb as Timer['cb'], args });
    return id;
  };
  w.setInterval = (cb: unknown, ms?: number, ...args: unknown[]) => {
    const id = ++timerSeq;
    const every = Math.max(1, Number(ms) || 0);
    if (typeof cb === 'function') timers.push({ id, at: now + every, cb: cb as Timer['cb'], args, every });
    return id;
  };
  w.clearTimeout = w.clearInterval = (id: number) => {
    timers = timers.filter((t) => t.id !== id);
  };
  // Media never plays on its own; frames are seeked explicitly.
  HTMLMediaElement.prototype.play = function play() {
    return Promise.resolve();
  };
  window.addEventListener('error', (event) => note(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => note(event.reason));

  const back = 1.70158;
  const ease: Record<string, (x: number) => number> = {
    linear: (x) => x,
    in: (x) => x * x * x,
    out: (x) => 1 - (1 - x) ** 3,
    inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
    outQuart: (x) => 1 - (1 - x) ** 4,
    outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
    inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
    outBack: (x) => 1 + (back + 1) * (x - 1) ** 3 + back * (x - 1) ** 2,
    spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(10 * x)),
  };
  const easing = (name: string | ((x: number) => number) = 'out') => (typeof name === 'function' ? name : (ease[name] ?? ease.out));
  const progress = (start: number, duration: number, how?: string | ((x: number) => number)) => {
    const x = duration <= 0 ? (now / 1000 >= start ? 1 : 0) : Math.min(1, Math.max(0, (now / 1000 - start) / duration));
    return easing(how)(x);
  };

  w.tilecast = {
    /** The render clock in seconds. */
    get time() {
      return now / 1000;
    },
    /** Called on every rendered frame with the time in seconds; may return a promise. */
    onFrame(fn: (t: number) => unknown) {
      hooks.push(fn);
    },
    ease,
    /** 0..1 progress of a move that starts at `start` and lasts `duration` seconds, eased. */
    progress,
    /** Value between `from` and `to` for a move from `start` lasting `duration` seconds. */
    tween(start: number, duration: number, from: number, to: number, how?: string | ((x: number) => number)) {
      return from + (to - from) * progress(start, duration, how);
    },
    /** A seeded random number generator: the same seed gives the same sequence in every frame. */
    random(seed = 1) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };

  const num = (value: string | null | undefined, fallback: number | null) => {
    const n = value === null || value === undefined || value === '' ? NaN : Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const ready = () => {
        const start = num(video.dataset.start, 0)!;
        const rate = num(video.dataset.rate, 1)!;
        let local = Math.max(0, (seconds - start) * rate);
        const length = Number.isFinite(video.duration) ? video.duration : Infinity;
        if (video.loop && Number.isFinite(length) && length > 0) local %= length;
        local = Math.min(local, Math.max(0, length - 0.001));
        video.pause();
        video.muted = true;
        if (Math.abs(video.currentTime - local) < 0.0005) return resolve();
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          video.removeEventListener('seeked', done);
          resolve();
        };
        video.addEventListener('seeked', done);
        realSetTimeout(done, 3000);
        video.currentTime = local;
      };
      if (video.readyState >= 1) ready();
      else {
        video.addEventListener('loadedmetadata', ready, { once: true });
        video.addEventListener('error', () => resolve(), { once: true });
        realSetTimeout(() => resolve(), 5000);
      }
    });
  }

  function adopt(at: number) {
    for (const animation of document.getAnimations()) {
      if (!born.has(animation)) born.set(animation, at);
    }
  }

  async function seek(seconds: number) {
    const target = Math.max(0, seconds * 1000);
    // Whatever started since the last frame (load events, media callbacks) began then.
    adopt(lastSeek);
    // Timers fire in order, each with the clock at its own due time.
    for (let guard = 0; guard < 20000; guard++) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > target) break;
      now = next.at;
      if (next.every) next.at += next.every;
      else timers.shift();
      try {
        next.cb(...next.args);
      } catch (error) {
        note(error);
      }
      // Anything this timer started (a class toggle, element.animate()) begins now,
      // however far this seek jumps.
      adopt(now);
    }
    now = target;
    // CSS animations, transitions and element.animate() are paused and placed at t.
    // An animation's local time starts when it first appeared.
    for (const animation of document.getAnimations()) {
      if (!born.has(animation)) born.set(animation, target);
      animation.pause();
      animation.currentTime = Math.max(0, target - born.get(animation)!);
    }
    lastSeek = target;
    const callbacks = [...rafs.values()];
    rafs.clear();
    for (const cb of callbacks) {
      try {
        cb(target);
      } catch (error) {
        note(error);
      }
    }
    for (const hook of hooks) {
      try {
        await hook(target / 1000);
      } catch (error) {
        note(error);
      }
    }
    for (const animation of document.getAnimations()) {
      if (!born.has(animation)) {
        born.set(animation, target);
        animation.pause();
        animation.currentTime = 0;
      }
    }
    await Promise.all([...document.querySelectorAll('video')].map((v) => seekVideo(v as HTMLVideoElement, target / 1000)));
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await new Promise((resolve) => realRaf(() => realRaf(resolve)));
  }

  function info() {
    const meta = (name: string) => document.querySelector(`meta[name="tilecast:${name}"]`)?.getAttribute('content') ?? null;
    let animationEnd = 0;
    for (const animation of document.getAnimations()) {
      const end = Number(animation.effect?.getComputedTiming().endTime);
      if (Number.isFinite(end)) animationEnd = Math.max(animationEnd, end + (born.get(animation) ?? 0));
    }
    const sceneMeta = meta('scenes');
    const scenes = (
      sceneMeta
        ? sceneMeta.split(/[\s,]+/).map(Number)
        : [...document.querySelectorAll<HTMLElement>('[data-scene-start]')].map((el) => Number(el.dataset.sceneStart))
    ).filter((n) => Number.isFinite(n) && n >= 0);
    const audio = [...document.querySelectorAll<HTMLAudioElement>('audio[data-tilecast]')].map((el) => ({
      src: el.currentSrc || el.src || el.querySelector('source')?.src || '',
      start: num(el.dataset.start, 0)!,
      volume: num(el.dataset.volume, 1)!,
      fadeIn: num(el.dataset.fadeIn, 0)!,
      fadeOut: num(el.dataset.fadeOut, 0)!,
      trim: num(el.dataset.trim, 0)!,
      duration: num(el.dataset.duration, null),
      loop: el.loop,
    }));
    return {
      title: document.title,
      duration: num(meta('duration'), null),
      fps: num(meta('fps'), null),
      poster: num(meta('poster'), null),
      scenes: [...new Set(scenes)].sort((a, b) => a - b),
      audio,
      animationEnd: animationEnd / 1000,
      animations: document.getAnimations().length,
      hooks: hooks.length,
    };
  }

  // ---- audit helpers --------------------------------------------------------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'OPTION']);
  const INLINE = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'ruby']);

  /** Text blocks: the nearest block-level element around each run of visible text, with its own text nodes. */
  function blocks(): Map<Element, Text[]> {
    const found = new Map<Element, Text[]>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim()) continue;
      let el = node.parentElement;
      if (!el || SKIP.has(el.tagName) || el.closest('svg defs, svg title')) continue;
      // Decorative text (a giant outlined word, code scrolling behind) is marked and not judged.
      if (el.closest('[aria-hidden="true"], [data-texture]')) continue;
      while (el.parentElement && el.parentElement !== document.body && INLINE.has(getComputedStyle(el).display)) {
        el = el.parentElement;
      }
      const nodes = found.get(el) ?? [];
      nodes.push(node as Text);
      found.set(el, nodes);
    }
    return found;
  }

  function keyOf(el: Element): string {
    const parts: string[] = [];
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const parent: Element | null = n.parentElement;
      parts.unshift(`${n.tagName.toLowerCase()}${parent ? [...parent.children].indexOf(n) : 0}`);
    }
    return parts.join('/');
  }

  /** Words a reader reads: separators like "·" or "—" don't count. */
  function countWords(text: string): number {
    return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  }

  function textOf(el: Element): string {
    // innerText keeps the break a <br> makes; textContent would glue the words together.
    return ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function describe(el: Element): string {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    const text = textOf(el);
    return `<${el.tagName.toLowerCase()}${id}${cls}>${text ? ` "${text.length > 48 ? `${text.slice(0, 45)}…` : text}"` : ''}`;
  }

  function opacityOf(el: Element): number {
    let opacity = 1;
    for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') return 0;
      opacity *= Number(cs.opacity);
    }
    return getComputedStyle(el).visibility === 'hidden' ? 0 : opacity;
  }

  /** Where the letters are: the text nodes' own boxes, not icons, badges or child blocks around them. */
  function textRect(nodes: Text[]): DOMRect | null {
    const range = document.createRange();
    const rects: DOMRect[] = [];
    for (const node of nodes) {
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }

  const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'svg', 'SVG']);

  /** Does this element paint something solid over what is below it? */
  function paintsSolid(n: Element): boolean {
    if (opacityOf(n) < 0.5) return false;
    if (MEDIA.has(n.tagName)) return true;
    const cs = getComputedStyle(n);
    return alphaOf(cs.backgroundColor) > 0.5 || cs.backgroundImage !== 'none';
  }

  function alphaOf(color: string): number {
    const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const rgba = color.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/);
    if (rgba) return Number(rgba[1]);
    return color === 'transparent' ? 0 : 1;
  }

  /** Share of the text hidden under other opaque elements (a later scene, a card, a photo). */
  function coveredShare(el: Element, r: DOMRect): number {
    let tested = 0;
    let covered = 0;
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.2, 0.3],
      [0.8, 0.3],
      [0.2, 0.7],
      [0.8, 0.7],
    ]) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      tested++;
      const top = document.elementFromPoint(x, y);
      if (!top || top === el || el.contains(top) || top.contains(el)) continue;
      for (let n: Element | null = top; n && !n.contains(el); n = n.parentElement) {
        if (paintsSolid(n)) {
          covered++;
          break;
        }
      }
    }
    return tested ? covered / tested : 0;
  }

  /**
   * The four corners of the text when the element itself is rotated or skewed:
   * the bounding rectangle of tilted text is much bigger than the text.
   */
  function textQuad(el: Element, nodes: Text[]): [number, number][] | null {
    const cs = getComputedStyle(el);
    if (cs.transform === 'none') return null;
    const m = new DOMMatrix(cs.transform);
    if (Math.abs(m.b) < 1e-3 && Math.abs(m.c) < 1e-3) return null;
    const html = el as HTMLElement;
    const previous = html.style.getPropertyValue('transform');
    const priority = html.style.getPropertyPriority('transform');
    // An !important inline value wins over animations, so the untransformed box can be measured.
    html.style.setProperty('transform', 'none', 'important');
    const box = el.getBoundingClientRect();
    const r = textRect(nodes);
    html.style.setProperty('transform', previous, priority);
    if (!r) return null;
    const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
    const origin = { x: box.left + ox, y: box.top + oy };
    return [
      [r.left, r.top],
      [r.right, r.top],
      [r.right, r.bottom],
      [r.left, r.bottom],
    ].map(([x, y]) => {
      const p = m.transformPoint(new DOMPoint(x - origin.x, y - origin.y));
      return [p.x + origin.x, p.y + origin.y] as [number, number];
    });
  }

  function insideShare(r: DOMRect): number {
    const x = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const y = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return r.width * r.height > 0 ? (x * y) / (r.width * r.height) : 0;
  }

  function clippedBy(el: Element, r: DOMRect): string | null {
    const cs = getComputedStyle(el);
    const html = el as HTMLElement;
    if (
      (cs.overflowX !== 'visible' && html.scrollWidth > html.clientWidth + 1) ||
      (cs.overflowY !== 'visible' && html.scrollHeight > html.clientHeight + 1)
    ) {
      return 'self';
    }
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === 'visible' && acs.overflowY === 'visible' && acs.clipPath === 'none') continue;
      const ar = a.getBoundingClientRect();
      if (r.left < ar.left - 1 || r.top < ar.top - 1 || r.right > ar.right + 1 || r.bottom > ar.bottom + 1) return describe(a);
    }
    return null;
  }

  const probe = document.createElement('canvas').getContext('2d');
  /** Is this family (in this weight and style) really drawn, or does the browser fall back? */
  async function fontAvailable(family: string, weight: string, style: string): Promise<boolean> {
    if (!probe || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|emoji|math|ui-[a-z-]+)$/i.test(family)) return true;
    const spec = `${style} ${weight} 72px "${family}"`;
    try {
      // A web font (bundled or @font-face) loads here, even a weight nothing has drawn yet.
      if ((await document.fonts.load(spec, 'Tilecast ąę')).length) return true;
    } catch {
      // An unparsable family name falls through to the measurement.
    }
    // Installed system fonts: compare metrics against two different fallbacks.
    const sample = 'Tilecast QWxyz 0123 ąęśż';
    return ['monospace', 'serif'].some((fallback) => {
      probe.font = `${style} ${weight} 72px ${fallback}`;
      const base = probe.measureText(sample).width;
      probe.font = `${spec}, ${fallback}`;
      return probe.measureText(sample).width !== base;
    });
  }

  function firstFamily(stack: string): string {
    return (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
  }

  async function audit() {
    const faces = new Map<string, [string, string, string]>();
    const texts = [...blocks()].flatMap(([el, nodes]) => {
      const r = textRect(nodes);
      if (!r) return [];
      const cs = getComputedStyle(el);
      const family = firstFamily(cs.fontFamily);
      faces.set(`${family}|${cs.fontWeight}|${cs.fontStyle}`, [family, cs.fontWeight, cs.fontStyle]);
      const text = textOf(el);
      // Every color the block's letters use: a highlighted word is text, not background.
      const colors = [...new Set(nodes.map((node) => getComputedStyle(node.parentElement!).color))];
      return [
        {
          key: keyOf(el),
          desc: describe(el),
          text: text.slice(0, 160),
          words: countWords(text),
          rect: [r.left, r.top, r.width, r.height],
          quad: textQuad(el, nodes),
          opacity: opacityOf(el) * (1 - coveredShare(el, r)),
          inside: insideShare(r),
          clippedBy: clippedBy(el, r),
          color: cs.color,
          colors,
          fontSize: parseFloat(cs.fontSize),
          fontWeight: Number(cs.fontWeight) || 400,
          family: firstFamily(cs.fontFamily),
        },
      ];
    });
    const missing = new Set<string>();
    for (const [family, weight, style] of faces.values()) {
      if (family && !missing.has(family) && !(await fontAvailable(family, weight, style))) missing.add(family);
    }
    return {
      width: innerWidth,
      height: innerHeight,
      texts,
      brokenImages: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute('src') ?? ''),
      missingFonts: [...missing],
      external: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /^https?:/i.test(name)),
      errors: errors.slice(),
    };
  }

  /** Fast per-frame sample of every text block, for timeline checks. */
  function sample() {
    return [...blocks()].flatMap(([el, nodes]) => {
      const r = textRect(nodes);
      if (!r) return [];
      const text = textOf(el);
      const opacity = opacityOf(el);
      const visible = opacity > 0.01 ? opacity * (1 - coveredShare(el, r)) : 0;
      const fontSize = parseFloat(getComputedStyle(el).fontSize) || 16;
      return [[keyOf(el), countWords(text), visible, insideShare(r), r.left, r.top, r.width, r.height, text.slice(0, 80), fontSize]];
    });
  }

  w.__tilecast = { seek, info, audit, sample, errors };
}

export function runtimeScript(fonts: RuntimeFont[]): string {
  return `(${tilecastRuntime.toString()})(${JSON.stringify({ fonts })});`;
}
