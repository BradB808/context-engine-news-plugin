import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout belongs exclusively to MCP. Never log article data or user queries.
process.on('SIGTERM', () => server.close().finally(() => process.exit(0)));
process.on('SIGINT', () => server.close().finally(() => process.exit(0)));
