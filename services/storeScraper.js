const axios = require('axios');

const logger = require('../utils/logger');
const { buildRuntimeSettings } = require('./storeSettings');

const STORE_SCRAPE_TIMEOUT_MS = Number(process.env.STORE_SCRAPE_TIMEOUT_MS || 4000);
const STORE_SCRAPE_CACHE_TTL_MS = Number(process.env.STORE_SCRAPE_CACHE_TTL_MS || 600000);

const cache = new Map();

function firstText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getStoreBaseUrl(shopDomain) {
  const runtime = buildRuntimeSettings(shopDomain);
  const normalized = firstText(runtime.contactUrl || runtime.shopDomain || process.env.SHOPIFY_STORE_DOMAIN);

  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized.replace(/\/+$/, '');
  }

  return `https://${normalized.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
}

function getCachedValue(key) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedValue(key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + STORE_SCRAPE_CACHE_TTL_MS,
  });
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBodyText(html) {
  const mainMatch = String(html || '').match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const source = mainMatch ? mainMatch[1] : html;
  return stripHtml(source);
}

function truncate(text, maxLength = 1200) {
  const normalized = firstText(text);

  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: STORE_SCRAPE_TIMEOUT_MS,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'StoreAssistantBot/1.0',
      },
      maxRedirects: 5,
    });

    const contentType = String(response.headers['content-type'] || '').toLowerCase();

    if (!contentType.includes('text/html')) {
      return null;
    }

    const titleMatch = String(response.data || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    return {
      url,
      title: truncate(stripHtml(titleMatch ? titleMatch[1] : ''), 120),
      snippet: truncate(extractBodyText(response.data), 1200),
    };
  } catch (error) {
    logger.warn('Store page scrape skipped', {
      url,
      message: error.message,
    });
    return null;
  }
}

async function getStoreKnowledge(shopDomain) {
  const baseUrl = getStoreBaseUrl(shopDomain);

  if (!baseUrl) {
    return {
      baseUrl: null,
      pages: [],
    };
  }

  const cacheKey = `store-knowledge:${baseUrl}`;
  const cached = getCachedValue(cacheKey);

  if (cached) {
    return cached;
  }

  const pageTargets = [
    { name: 'Home', url: `${baseUrl}/` },
    { name: 'Shipping Policy', url: `${baseUrl}/policies/shipping-policy` },
    { name: 'Refund Policy', url: `${baseUrl}/policies/refund-policy` },
    { name: 'Privacy Policy', url: `${baseUrl}/policies/privacy-policy` },
    { name: 'Terms of Service', url: `${baseUrl}/policies/terms-of-service` },
    { name: 'Track Your Order', url: `${baseUrl}/pages/track-your-order` },
    { name: 'Returns & Exchange', url: `${baseUrl}/pages/returns-exchange` },
    { name: 'Returns and Exchange', url: `${baseUrl}/pages/returns-and-exchange` },
    { name: 'Refund Policy Page', url: `${baseUrl}/pages/refund-policy` },
    { name: 'Privacy Policy Page', url: `${baseUrl}/pages/privacy-policy` },
    { name: 'Terms Page', url: `${baseUrl}/pages/terms-of-service` },
    { name: 'Contact', url: `${baseUrl}/pages/contact` },
    { name: 'About', url: `${baseUrl}/pages/about` },
  ];

  const results = await Promise.all(pageTargets.map((page) => fetchPage(page.url)));
  const pages = results
    .map((page, index) => {
      if (!page || !page.snippet) {
        return null;
      }

      return {
        name: pageTargets[index].name,
        url: page.url,
        title: page.title || pageTargets[index].name,
        snippet: page.snippet,
      };
    })
    .filter(Boolean);

  const knowledge = {
    baseUrl,
    pages,
  };

  setCachedValue(cacheKey, knowledge);

  return knowledge;
}

module.exports = {
  getStoreKnowledge,
};
