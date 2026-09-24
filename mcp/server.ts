import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TilecastService } from './service';
import { createTilecastServer } from './tools';

// Designs and exports go into the project the agent is working in.
const root = process.env.TILECAST_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();

const server = createTilecastServer(new TilecastService(root));
await server.connect(new StdioServerTransport());
console.error(`[tilecast] MCP server ready, project: ${root}`);
