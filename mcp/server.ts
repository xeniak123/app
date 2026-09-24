import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TilecastService } from './service';
import { createTilecastServer } from './tools';

// Compositions are read from, and renders written into, the project the agent is working in.
const root = process.env.TILECAST_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();

const service = new TilecastService(root);
const server = createTilecastServer(service);
await server.connect(new StdioServerTransport());
console.error(`[tilecast] MCP server ready, project: ${root}`);

const stop = async () => {
  await service.shutdown().catch(() => undefined);
  process.exit(0);
};
process.stdin.on('close', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
