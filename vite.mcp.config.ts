import { defineConfig } from 'vite';

// Bundles the MCP server, its dependencies and the fonts into one file that
// the Claude Code plugin (or any MCP client) runs with plain `node`.
export default defineConfig({
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
