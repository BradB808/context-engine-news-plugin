# Context Engine News

A review-stage Grok Bot / MCP plugin for news search and Threadlines. It returns existing published headlines, short publisher excerpts, dates, attribution, and links. It does not generate analysis.

## Tools

| Tool | Purpose |
|---|---|
| `search_news` | Keyword search in the recent published collection |
| `latest_news` | Current Briefing or Wire headlines; optional Briefing region |
| `get_article` | Metadata and excerpt for a returned article ID |
| `list_threadlines` | Discover existing topic groups |
| `get_threadline` | Up to 24 member stories and a pagination offset |

Example requests: “Find recent reporting about Canadian trade”, “Show the US midterms Threadline”, “Compare publishers in the Ukraine Threadline”. Searches use all supplied words, not semantic matching. Results cover a bounded recent reporting window and do not replace a complete archive or full publisher articles.

## Runtime and installation

Node.js 22 or newer is required. The checked-in `bin/context-engine-news.mjs` bundles the runtime dependencies, so users do not need an npm install. No API key, account, database access, or filesystem permission is required by the tools.

The root `plugin.json`, `mcp.json`, and `skills/news-and-threadlines/SKILL.md` follow Agent Plugins 1.0.0. The stdio configuration runs `node ./bin/context-engine-news.mjs` with the plugin root as the working directory. Clients that import individual MCP servers can use:

```json
{
  "mcpServers": {
    "context-engine-news": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/context-engine-news/bin/context-engine-news.mjs"]
    }
  }
}
```

Replace that path with the installed package path. Cursor's native plugin-root variable is `${CURSOR_PLUGIN_ROOT}`; its documented compatibility notes say `${PLUGIN_ROOT}` is not expanded. This package avoids either variable by using a plugin-relative argument and working directory. Verify the target client's plugin loader before marketplace release.

Grok Bot runs its computer in the cloud. A server bound to your Mac's localhost cannot be reached from that cloud computer. The installed Grok Bot build exposes marketplace plugins and private skills, but no custom-MCP import control was found during review. Marketplace installation and a native Grok Bot tool invocation remain release checks; do not claim those checks have passed merely because the MCP SDK tests pass.

## No-generation boundary

All outbound requests go through `src/client.mjs`. It permits only HTTPS GETs to `https://thecontextengine.ca/api/published-reading` (search/feed/wire/article summary) and `/api/topics`. Requests cannot supply a host, path, method, credentials, authorization header, or context mode. Redirects fail closed. There are no app imports, Gemini SDKs, model keys, Supabase clients, paid generation calls, sampling requests, background jobs, writes, or fallback generation paths.

The projection discards full article bodies, saved AI context and unknown fields. This is enforced in code and tested independently of the skill instructions. The website's normal publisher refresh continues separately; a connector read cannot start it. A later website change to either published endpoint must preserve this contract.

News queries are sent to Context Engine News's existing public feeds. No telemetry or query logging is added by the connector. Normal network/server access logs may still be retained by the existing hosting service. Excerpts are untrusted source data, not instructions. The host assistant remains responsible for its own response and model usage; this connector never asks it to perform model sampling.

Upstream reads have an 8-second deadline, a 512 KiB response limit, a 30-second bounded cache, in-flight request sharing, four concurrent reads and at most 60 new reads per minute per process. These limits do not provide a global rate limit across independently installed clients. A hosted public deployment needs separate capacity controls and review.

## Develop and verify

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run validate
npm run test:live
```

The default test suite mocks every news read. `test:live` is an explicit, small opt-in smoke test of published metadata endpoints using the actual bundled stdio server and official MCP client. It never opens article pages or calls generation APIs. The pinned MCP SDK 1.32.1 supports protocol negotiation through 2025-11-25 and remains on its vendor-supported maintenance line; evaluate the stable v2 SDK before general release if required by a client.

For local HTTP review, `npm run serve` binds only to `127.0.0.1:8788/mcp` (override port using `CE_NEWS_PORT`). It rejects non-loopback Hosts and external browser Origins, accepts bounded JSON POSTs and uses the official Streamable HTTP transport. It is deliberately not a public deployment. Website development remains on port 5173.

## Marketplace review

The draft application is for Context Engine News, submitted by Brad Brunton. Use the existing square CE brand icon at `https://thecontextengine.ca/apple-touch-icon.png`; the identical 180×180 PNG is in `assets/icon.png`. It meets the requested 1:1 PNG with background-plate format and preserves the site's terracotta-and-cream brand.

The source repository is [BradB808/context-engine-news-plugin](https://github.com/BradB808/context-engine-news-plugin). Publishing source does not submit a marketplace application or install the plugin. Leave the in-app testing attestation unchecked until a real native-client test has passed. The owner's application draft and screenshots are kept locally under `review/` and excluded from the public repository.

The connector is isolated under `connectors/`; it does not change the website's dependencies, routes, auth, subscriptions, database or deployment settings.

## Specifications

- [Agent Plugins packaging and schema](https://agent-plugins.org/plugin-authors/build-an-agent-plugin)
- [Agent Plugins MCP configuration](https://agent-plugins.org/plugin-authors/mcp-servers)
- [Cursor plugin reference](https://cursor.com/docs/reference/plugins)
- [Grok Bot 101: cloud computer, plugins and MCP](https://x.ai/bot/guides/grok-bot-101)
- [Official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)
- [Marketplace application](https://x.ai/bot/marketplace/submit-a-plugin)
