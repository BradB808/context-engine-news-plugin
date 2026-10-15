export const NOW = Date.parse('2026-10-15T00:00:00Z');
export const row = {
  guardian_id: 'curated/example-news/2026-10-14/rates-and-trade', title: 'Rates and trade',
  section: 'business', trail_text: 'A short publisher excerpt.', source_name: 'Example News',
  source: 'curated-rss', web_url: 'https://publisher.example/news/rates', web_publication_date: '2026-10-14T22:00:00Z',
  body_blocks: [{ type: 'paragraph', text: 'FULL ARTICLE MUST NOT LEAK' }],
  dossierContext: { why: 'SAVED AI CONTEXT MUST NOT LEAK' }, private_email: 'PRIVATE DATA MUST NOT LEAK',
};
export const member = {
  id: row.guardian_id, title: row.title, summary: row.trail_text, sourceName: row.source_name,
  sourceUrl: row.web_url, publishedAt: row.web_publication_date, section: row.section,
  imageUrl: 'https://publisher.example/image.png',
};
export const topic = {
  slug: 'trade-tariffs', label: 'Tariffs & trade', description: 'Recent trade reporting.',
  articleCount: 25, sourceCount: 3, latestAt: member.publishedAt, lead: member, active: true,
};
export function fixtureFetch(calls = []) {
  return async (input, init) => {
    calls.push({ url: input, init });
    const url = new URL(input);
    let data;
    if (url.pathname === '/api/topics') {
      data = url.searchParams.has('topic')
        ? { topic, articles: [member], contexts: [{ why: 'SAVED AI CONTEXT MUST NOT LEAK' }], nextOffset: Number(url.searchParams.get('offset')) === 0 ? 24 : null }
        : { topics: [topic], featured: [topic.slug], limited: true };
    } else data = { data: url.searchParams.get('kind') === 'article' ? row : [row] };
    return Response.json({ ...data, fetchedAt: NOW, stale: false });
  };
}
