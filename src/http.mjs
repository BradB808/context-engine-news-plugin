import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.mjs';
import { createNewsClient } from './client.mjs';

/** Loopback-only review server. Public hosting requires a separate reviewed deployment. */
export function createHttpApp(client = createNewsClient()) {
  let active = 0;
  return createHttpServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const respond = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
    // Reject browser cross-origin requests and DNS rebinding. Do not trust forwarded hosts.
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return respond(403, 'Invalid host');
    if (req.headers.origin) {
      try { if (!['http://127.0.0.1', 'http://localhost', 'http://[::1]'].includes(new URL(req.headers.origin).origin.replace(/:\d+$/, ''))) return respond(403, 'Invalid origin'); }
      catch { return respond(403, 'Invalid origin'); }
    }
    if (req.url === '/health' && req.method === 'GET') return respond(200, 'Context Engine News MCP review server');
    if (req.url !== '/mcp') return respond(404, 'Not found');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return respond(405, 'Only MCP POST is supported'); }
    if (active >= 8) return respond(429, 'Too many concurrent requests');
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return respond(415, 'JSON required');
    const length = Number(req.headers['content-length'] || 0);
    if (!Number.isFinite(length) || length > 16_384) return respond(413, 'Request too large');
    active++;
    let server, transport;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) { respond(413, 'Request too large'); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return respond(400, 'Invalid JSON'); }
      if (Array.isArray(body)) return respond(400, 'Batch requests are not supported');
      server = createServer(client);
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) respond(500, 'MCP request failed');
      else res.end();
    } finally { active--; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.CE_NEWS_PORT || 8788);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid CE_NEWS_PORT');
  const app = createHttpApp();
  app.listen(port, '127.0.0.1', () => console.error(`Review MCP: http://127.0.0.1:${port}/mcp`));
  process.on('SIGTERM', () => app.close());
  process.on('SIGINT', () => app.close());
}
