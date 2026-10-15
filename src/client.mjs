// This module is the connector's entire outbound network boundary.
// No app imports, credentials, arbitrary URLs, POSTs or generation fallbacks.
const ORIGIN = 'https://thecontextengine.ca';
const MAX_BYTES = 512 * 1024;
const MAX_AGE = 72 * 60 * 60 * 1000;
const TTL = 30_000;
const CONTROL = /[\u0000-\u001f\u007f]/;
export class NewsError extends Error {}

function requireValue(condition, message = 'Invalid published feed response') {
  if (!condition) throw new NewsError(message);
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function clean(value, max = 1200) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g,
    entity => ({'&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'", '&#39;':"'", '&nbsp;':' '})[entity])
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function publisherExcerpt(value, title) {
  let summary = clean(value);
  // Known RSS newsletter prefix: tracking marker, duplicated section, label.
  summary = summary.replace(/^\{beacon\}\s*([^{}]{1,80}?)\s+\1\s+The Big Story\s+/i, '')
    .replace(/^\{beacon\}\s*/i, '');
  const comparable = text => text.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
  const footer = summary.match(/(?:^|\s)The post (.+?) appeared first on .+?\.?$/i);
  if (footer && comparable(footer[1]) === comparable(title)) summary = summary.slice(0, footer.index).trim();
  // An empty excerpt is more honest than manufacturing a replacement summary.
  return comparable(summary) === comparable(title) ? '' : summary;
}
function safeLink(value) {
  if (typeof value !== 'string' || value.length > 4096 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function iso(value) {
  requireValue(typeof value === 'string' && value.length < 70 && Number.isFinite(Date.parse(value)));
  return new Date(value).toISOString();
}
export function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !/[\s\u0000-\u001f\u007f?#%\\]/.test(value) && !value.includes('://')
    && !value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.');
}
function articleUrl(id) {
  requireValue(validId(id));
  const route = id.startsWith('market/') ? '/market-news/' : id.startsWith('curated/') ? '/briefing/' : '/dossier/';
  return `${ORIGIN}${route}${encodeURIComponent(id.startsWith('market/') ? id.slice(7) : id)}`;
}
function article(row, topic = false) {
  requireValue(object(row));
  const id = topic ? row.id : row.guardian_id;
  const title = clean(row.title, 500);
  const publisher = clean(topic ? row.sourceName : (row.source_name || (row.source === 'guardian' ? 'The Guardian' : '')), 120);
  const sourceUrl = safeLink(topic ? row.sourceUrl : row.web_url);
  requireValue(validId(id) && title && sourceUrl);
  const summary = publisherExcerpt(topic ? row.summary : row.trail_text, title);
  // Explicit projection prevents bodies, AI context or account fields escaping.
  return {
    article_id: id, title, summary, summary_available: !!summary,
    publisher: publisher || new URL(sourceUrl).hostname,
    published_at: iso(topic ? row.publishedAt : row.web_publication_date),
    section: clean(row.section, 100), url: articleUrl(id), source_url: sourceUrl,
  };
}
function topicCard(row) {
  requireValue(object(row) && typeof row.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) && row.slug.length <= 90);
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
  requireValue(count(row.articleCount) && count(row.sourceCount) && typeof row.active === 'boolean');
  return {
    slug: row.slug, title: clean(row.label, 150), description: clean(row.description, 600),
    article_count: row.articleCount, publisher_count: row.sourceCount,
    latest_at: iso(row.latestAt), active: row.active,
    url: `${ORIGIN}/themes/${row.slug}`, lead: article(row.lead, true),
  };
}
function freshness(timestamp, now, stale = false) {
  requireValue(Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 60_000
    && now - timestamp < MAX_AGE, 'The published edition is missing or too old. Try again later.');
  return { published_feed_at: new Date(timestamp).toISOString(), stale: stale === true || now - timestamp > 30 * 60_000 };
}
function envelope(fresh, data, extra = {}) {
  return {
    provider: 'Context Engine News', ...fresh,
    coverage: 'A bounded recent published collection, not a complete news archive. Topic membership does not establish that reports describe the same event.',
    ...data, ...extra,
  };
}

/** Injection is for offline tests only; production entrypoints use global fetch. */
export function createNewsClient({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const cache = new Map(), pending = new Map();
  let windowStart = now(), requestCount = 0, running = 0;

  async function read(path, params = {}) {
    const url = new URL(path, ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    // Even internal caller errors must fail closed before fetch.
    const query = url.searchParams;
    const newsKeys = ['kind', 'q', 'country', 'limit', 'id', 'view'];
    const validNews = path === '/api/published-reading'
      && ['search', 'feed', 'wire', 'article'].includes(query.get('kind'))
      && [...query.keys()].every(key => newsKeys.includes(key))
      && (query.get('kind') !== 'article' || query.get('view') === 'summary');
    const validTopics = path === '/api/topics' && [...query.keys()].every(key => ['topic', 'offset'].includes(key));
    requireValue(url.origin === ORIGIN && (validNews || validTopics), 'Blocked outbound request');
    const key = url.href, cached = cache.get(key);
    if (cached && now() - cached.at < TTL) return structuredClone(cached.value);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    if (now() - windowStart >= 60_000) { windowStart = now(); requestCount = 0; }
    requireValue(requestCount < 60 && running < 4, 'Connector request limit reached. Wait a minute and try again.');
    requestCount++; running++;
    const work = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.href, {
          method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'ContextEngineNewsConnector/0.1.1' },
        });
        requireValue(!response.redirected && (!response.url || response.url === key), 'Blocked redirected feed');
        if (response.status === 404) throw new NewsError('Not present in the current published collection.');
        requireValue(response.ok, 'Published news is temporarily unavailable. Try again later.');
        requireValue(response.headers.get('content-type')?.toLowerCase().includes('application/json'));
        const size = Number(response.headers.get('content-length') || 0);
        requireValue(Number.isFinite(size) && size >= 0 && size <= MAX_BYTES, 'Published response is too large');
        requireValue(response.body, 'Empty published response');
        const reader = response.body.getReader();
        let total = 0; const chunks = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            requireValue(total <= MAX_BYTES, 'Published response is too large');
            chunks.push(value);
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        const bytes = new Uint8Array(total); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        requireValue(object(value));
        // Validate freshness before caching, including after an idle cached read.
        freshness(value.fetchedAt, now(), value.stale);
        if (cache.size >= 64) cache.delete(cache.keys().next().value);
        cache.set(key, { at: now(), value });
        return value;
      } catch (error) {
        if (error instanceof NewsError) throw error;
        throw new NewsError('Could not read the published feed. No context was generated.');
      } finally { clearTimeout(timer); }
    })();
    pending.set(key, work);
    try { return structuredClone(await work); }
    finally { pending.delete(key); running--; }
  }
  function queryText(value, optional = false) {
    requireValue(typeof value === 'string' && !CONTROL.test(value) && value.length <= 200
      && (optional || value.trim().length >= 2), 'Use a search query of 2–200 characters.');
    return value.trim();
  }
  function limitValue(value) {
    requireValue(Number.isSafeInteger(value) && value >= 1 && value <= 20, 'Limit must be an integer from 1 to 20.');
    return value;
  }
  function newsResult(raw) {
    requireValue(Array.isArray(raw.data) && raw.data.length <= 100);
    return envelope(freshness(raw.fetchedAt, now()), { articles: raw.data.map(row => article(row)) });
  }
  return Object.freeze({
    async searchNews({ query, limit = 8 }) {
      return newsResult(await read('/api/published-reading', { kind: 'search', q: queryText(query), limit: limitValue(limit) }));
    },
    async latestNews({ region = 'all', feed = 'briefing', limit = 8 } = {}) {
      requireValue(['all', 'us', 'ca', 'asia'].includes(region) && ['briefing', 'wire'].includes(feed), 'Unknown region or feed.');
      requireValue(feed !== 'wire' || region === 'all', 'The Wire does not have a region filter.');
      return newsResult(await read('/api/published-reading', { kind: feed === 'wire' ? 'wire' : 'feed', country: region, limit: limitValue(limit) }));
    },
    async getArticle({ article_id }) {
      requireValue(validId(article_id), 'Use an article_id returned by a news tool, not a URL.');
      const raw = await read('/api/published-reading', { kind: 'article', id: article_id, view: 'summary' });
      requireValue(raw.data?.guardian_id === article_id);
      return envelope(freshness(raw.fetchedAt, now()), { article: article(raw.data) });
    },
    async listThreadlines({ query = '', limit = 12 } = {}) {
      const filter = queryText(query, true).toLocaleLowerCase('en');
      limitValue(limit);
      const raw = await read('/api/topics');
      requireValue(Array.isArray(raw.topics) && raw.topics.length <= 36 && typeof raw.limited === 'boolean');
      const featured = new Set(Array.isArray(raw.featured) ? raw.featured : []);
      const topics = raw.topics.map(row => ({ ...topicCard(row), featured: featured.has(row.slug) }))
        .filter(row => !filter || `${row.title} ${row.description}`.toLocaleLowerCase('en').includes(filter));
      return envelope(freshness(raw.fetchedAt, now(), raw.stale), { threadlines: topics.slice(0, limit) }, {
        limited: raw.limited, coverage_limited: raw.limited,
        returned_threadlines: Math.min(topics.length, limit), matching_threadlines: topics.length,
        more_matching_threadlines: topics.length > limit,
      });
    },
    async getThreadline({ slug, offset = 0 }) {
      requireValue(typeof slug === 'string' && slug.length <= 90 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), 'Use a slug returned by list_threadlines.');
      requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= 3250 && offset % 24 === 0, 'Offset must be a page boundary (0, 24, 48…) up to 3250.');
      const raw = await read('/api/topics', { topic: slug, offset });
      requireValue(raw.topic?.slug === slug && Array.isArray(raw.articles) && raw.articles.length <= 24);
      requireValue(raw.nextOffset === null || (Number.isSafeInteger(raw.nextOffset) && raw.nextOffset === offset + 24 && raw.nextOffset <= 3250));
      return envelope(freshness(raw.fetchedAt, now(), raw.stale), {
        threadline: topicCard(raw.topic), articles: raw.articles.map(row => article(row, true)), next_offset: raw.nextOffset,
      });
    },
  });
}
