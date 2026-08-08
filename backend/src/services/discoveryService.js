const https = require('https');
const http = require('http');

/**
 * Helper to make HTTP GET requests and parse JSON/XML responses without heavy external dependencies.
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
 * Strip HTML tags and decode common HTML entities from RSS snippets.
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Extracts basic item objects from RSS/Atom XML string
 */
function parseRssItems(xmlText) {
  const items = [];
  const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/gi) || xmlText.match(/<entry>[\s\S]*?<\/entry>/gi) || [];

  for (const xmlItem of itemMatches.slice(0, 10)) {
    const titleMatch = xmlItem.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = xmlItem.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || xmlItem.match(/href=["']([^"']+)["']/i);
    const descMatch = xmlItem.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || xmlItem.match(/<summary>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);
    const pubDateMatch = xmlItem.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || xmlItem.match(/<published>([\s\S]*?)<\/published>/i);

    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : null;
    const sourceUrl = linkMatch ? linkMatch[1].trim() : null;
    let snippet = descMatch ? decodeHtmlEntities(descMatch[1]) : decodeHtmlEntities(title);
    const publishedAt = pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString();

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
 * Search Tavily API if key is available
 */
async function fetchFromTavily(domainQuery) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const responseText = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        query: `${domainQuery} recent breakthroughs vulnerabilities news`,
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
      title: r.title,
      snippet: r.content || r.title,
      sourceUrl: r.url,
      publishedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('[Discovery] Tavily fetch failed, falling back to RSS:', err.message);
    return [];
  }
}

/**
 * Fetch from Google News RSS for the target domain
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
 * Fetch top AI stories from Hacker News API
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
              title: item.title,
              snippet: item.title,
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
 * @param {string} domain - e.g. "AI Security", "Machine Learning Engineer", "Robotics Engineer"
 * @returns {Promise<Array<{title: string, snippet: string, sourceUrl: string, publishedAt: string}>>}
 */
async function discoverTopics(domain) {
  console.log(`[Discovery] Initiating live discovery for domain: "${domain}"`);

  // 1. Try Tavily search API if key configured
  let candidates = await fetchFromTavily(domain);

  // 2. Fetch Google News RSS for specified domain
  if (candidates.length < 3) {
    const rssCandidates = await fetchFromGoogleNewsRss(domain);
    candidates = [...candidates, ...rssCandidates];
  }

  // 3. Fallback to Hacker News for general tech if candidates still low
  if (candidates.length < 3) {
    const hnCandidates = await fetchFromHackerNews();
    candidates = [...candidates, ...hnCandidates];
  }

  // Deduplicate by URL and Title within candidate pool
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