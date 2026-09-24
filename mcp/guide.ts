/**
 * The skill's playbook, bundled so agents without Claude Code skills (Codex,
 * Cursor, any MCP client) can read it through the guide tool.
 */

const files = import.meta.glob('../plugin/skills/tilecast/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const GUIDE_TOPICS = ['workflow', 'design', 'motion', 'tones', 'audio', 'runtime'] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

const FILES: Record<GuideTopic, string> = {
  workflow: 'SKILL.md',
  design: 'references/design.md',
  motion: 'references/motion.md',
  tones: 'references/tones.md',
  audio: 'references/audio.md',
  runtime: 'references/runtime.md',
};

export function readGuide(topic: GuideTopic): string {
  const source = files[`../plugin/skills/tilecast/${FILES[topic]}`];
  if (!source) throw new Error(`The ${topic} guide is missing from this build.`);
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return topic === 'workflow'
    ? `${body}\n\n(Links to references/<topic>.md mean: call the guide tool with that topic.)`
    : body;
}
