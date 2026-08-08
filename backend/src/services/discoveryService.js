const https = require('https');
const http = require('http');

/**
 * Helper to make HTTP GET requests with redirect follow support.
 */
function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', ...headers } }, (res) => {
      let data = '';
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, headers));
      }
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Strip raw HTML tags and decode HTML entities from web and RSS snippets.
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, '') // Strip HTML elements (<a href=...>, <font>, etc.)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses item entries from raw XML
 */
function parseRssItems(xmlText) {
  const items = [];
  const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/gi) || xmlText.match(/<entry>[\s\S]*?<\/entry>/gi) || [];

  for (const xmlItem of itemMatches.slice(0, 10)) {
    const titleMatch = xmlItem.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = xmlItem.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || xmlItem.match(/href=["']([^"']+)["']/i);
    const descMatch = xmlItem.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || xmlItem.match(/<summary>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);
    const pubDateMatch = xmlItem.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || xmlItem.match(/<published>([\s\S]*?)<\/published>/i);

    const title = titleMatch ? cleanText(titleMatch[1]) : null;
    const sourceUrl = linkMatch ? linkMatch[1].trim() : null;
    let rawSnippet = descMatch ? descMatch[1] : (titleMatch ? titleMatch[1] : '');
    const snippet = cleanText(rawSnippet);
    const publishedAt = pubDateMatch ? cleanText(pubDateMatch[1]) : new Date().toISOString();

    if (title && sourceUrl) {
      items.push({
        title,
        snippet: snippet.slice(0, 300),
        sourceUrl,
        publishedAt,
      });
    }
  }

  return items;
}

/**
 * Search Tavily API
 */
async function fetchFromTavily(domainQuery) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const responseText = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        query: `${domainQuery} recent developments breakthroughs security vulnerabilities`,
        topic: 'news',
        search_depth: 'advanced',
        max_results: 8,
      });

      const req = https.request('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    const parsed = JSON.parse(responseText);
    if (!parsed.results) return [];

    return parsed.results.map((r) => ({
      title: cleanText(r.title),
      snippet: cleanText(r.content || r.title).slice(0, 300),
      sourceUrl: r.url,
      publishedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('[Discovery] Tavily fetch fallback triggered:', err.message);
    return [];
  }
}

/**
 * Google News RSS Source
 */
async function fetchFromGoogleNewsRss(domainQuery) {
  try {
    const encodedQuery = encodeURIComponent(`${domainQuery} AI technology`);
    const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await fetchUrl(rssUrl);
    return parseRssItems(xml);
  } catch (err) {
    console.warn('[Discovery] Google News RSS fetch failed:', err.message);
    return [];
  }
}

/**
 * Hacker News API Source
 */
async function fetchFromHackerNews() {
  try {
    const topIdsRaw = await fetchUrl('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topIds = JSON.parse(topIdsRaw).slice(0, 15);

    const stories = await Promise.all(
      topIds.map(async (id) => {
        try {
          const itemRaw = await fetchUrl(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const item = JSON.parse(itemRaw);
          if (item && item.url && item.title) {
            return {
              title: cleanText(item.title),
              snippet: cleanText(item.title),
              sourceUrl: item.url,
              publishedAt: new Date(item.time * 1000).toISOString(),
            };
          }
        } catch {
          return null;
        }
      })
    );

    return stories.filter(Boolean);
  } catch (err) {
    console.warn('[Discovery] HackerNews fetch failed:', err.message);
    return [];
  }
}

/**
 * Main Topic Discovery function
 */
async function discoverTopics(domain) {
  console.log(`[Discovery] Initiating live discovery for domain: "${domain}"`);

  let candidates = await fetchFromTavily(domain);

  if (candidates.length < 3) {
    const rssCandidates = await fetchFromGoogleNewsRss(domain);
    candidates = [...candidates, ...rssCandidates];
  }

  if (candidates.length < 3) {
    const hnCandidates = await fetchFromHackerNews();
    candidates = [...candidates, ...hnCandidates];
  }

  const seenUrls = new Set();
  const uniqueCandidates = candidates.filter((item) => {
    if (!item.sourceUrl || seenUrls.has(item.sourceUrl)) return false;
    seenUrls.add(item.sourceUrl);
    return true;
  });

  console.log(`[Discovery] Discovered ${uniqueCandidates.length} unique candidate topics.`);
  return uniqueCandidates.slice(0, 10);
}

module.exports = {
  discoverTopics,
};