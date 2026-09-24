let counter = 0;

/** Short unique id; works without `crypto.randomUUID`, which needs a secure context. */
export function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `t${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Random seed for an image tile's generated artwork, so every new tile gets a different picture. */
export function newArtSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
