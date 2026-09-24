import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Writes the licenses of every npm package that ends up in the bundle next to it. */
function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle() {
      const packages = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        const match = id.replaceAll('\\', '/').match(/^(.*\/node_modules\/)((?:@[^/]+\/)?[^/?]+)/);
        if (match) packages.set(match[2], match[1] + match[2]);
      }
      const sections = [...packages]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, dir]) => {
          const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string; license?: string };
          const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
          const text = file ? readFileSync(path.join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'see package'}`;
          return `## ${name} ${pkg.version} (${pkg.license ?? 'see license text'})\n\n\`\`\`\n${text}\n\`\`\``;
        });
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.md',
        source: `# Third-party notices\n\ntilecast-mcp.mjs bundles code, fonts and icons from these packages; their licenses follow.\n\n${sections.join('\n\n')}\n`,
      });
    },
  };
}

// Bundles the MCP server, its dependencies and the fonts into one file that
// the Claude Code plugin (or any MCP client) runs with plain `node`.
export default defineConfig({
  plugins: [thirdPartyNotices()],
  build: {
    ssr: 'mcp/server.ts',
    outDir: 'plugin/server',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'tilecast-mcp.mjs',
        format: 'es',
        banner: '#!/usr/bin/env node',
        codeSplitting: false,
      },
    },
  },
  ssr: {
    target: 'node',
    noExternal: true,
  },
});
