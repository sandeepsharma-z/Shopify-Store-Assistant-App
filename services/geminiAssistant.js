const axios = require('axios');

const logger = require('../utils/logger');
const { DEFAULT_CATALOG_SUGGESTIONS, createCatalogReply } = require('./shopifyCatalog');
const { getStoreKnowledge } = require('./storeScraper');
const { buildRuntimeSettings } = require('./storeSettings');
const { createSupportReply, getSupportConfig } = require('./storeSupport');

const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 12000);
const GEMINI_API_BASE_URL =
  (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').trim() ||
  'https://generativelanguage.googleapis.com/v1beta';

function firstText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function truncate(text, maxLength = 1600) {
  const normalized = firstText(text);

  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function getGeminiConfig(shopDomain) {
  const runtime = buildRuntimeSettings(shopDomain);
  const apiKey = firstText(runtime.geminiApiKey || process.env.GEMINI_API_KEY);

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: GEMINI_MODEL,
    timeoutMs: GEMINI_TIMEOUT_MS,
  };
}

function formatCatalogItems(catalog) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];

  if (!items.length) {
    return 'No direct catalog items matched this question.';
  }

  return items
    .slice(0, 6)
    .map((item, index) => {
      const parts = [
        `${index + 1}. ${item.title || 'Untitled item'}`,
        item.price ? `Price: ${item.price}` : null,
        typeof item.available === 'boolean' ? `Availability: ${item.available ? 'In stock' : 'Out of stock'}` : null,
        item.vendor ? `Brand: ${item.vendor}` : null,
        item.productType ? `Type: ${item.productType}` : null,
        Array.isArray(item.collections) && item.collections.length
          ? `Collections: ${item.collections.slice(0, 3).join(', ')}`
          : null,
        item.description ? `Description: ${truncate(item.description, 280)}` : null,
        item.url ? `URL: ${item.url}` : null,
      ].filter(Boolean);

      return parts.join(' | ');
    })
    .join('\n');
}

function formatOverviewCatalog(catalog) {
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  const collections = Array.isArray(catalog?.collections) ? catalog.collections : [];

  return [
    products.length
      ? `Featured products:\n${products
          .slice(0, 4)
          .map((item, index) => `${index + 1}. ${item.title}${item.price ? ` | ${item.price}` : ''}`)
          .join('\n')}`
      : null,
    collections.length
      ? `Collections:\n${collections
          .slice(0, 4)
          .map((item, index) => `${index + 1}. ${item.title}${item.url ? ` | ${item.url}` : ''}`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildPrompt({
  message,
  shopDomain,
  supportReply,
  supportConfig,
  catalogReply,
  storeKnowledge,
}) {
  const supportSummary = [
    supportConfig.storeName ? `Store name: ${supportConfig.storeName}` : null,
    supportConfig.supportEmail ? `Support email: ${supportConfig.supportEmail}` : null,
    supportConfig.supportPhone ? `Support phone: ${supportConfig.supportPhone}` : null,
    supportConfig.supportWhatsapp ? `Support WhatsApp: ${supportConfig.supportWhatsapp}` : null,
    supportConfig.supportHours ? `Support hours: ${supportConfig.supportHours}` : null,
    supportConfig.shippingPolicy ? `Shipping policy: ${truncate(supportConfig.shippingPolicy, 320)}` : null,
    supportConfig.returnPolicy ? `Return policy: ${truncate(supportConfig.returnPolicy, 320)}` : null,
    supportConfig.codPolicy ? `Payment policy: ${truncate(supportConfig.codPolicy, 220)}` : null,
    supportConfig.cancellationPolicy
      ? `Cancellation policy: ${truncate(supportConfig.cancellationPolicy, 220)}`
      : null,
    supportConfig.aboutText ? `About store: ${truncate(supportConfig.aboutText, 320)}` : null,
    supportConfig.storeUrl ? `Store URL: ${supportConfig.storeUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const pageSummary = Array.isArray(storeKnowledge?.pages)
    ? storeKnowledge.pages
        .slice(0, 5)
        .map(
          (page, index) =>
            `${index + 1}. ${page.name}${page.url ? ` (${page.url})` : ''}\n${truncate(page.snippet, 500)}`,
        )
        .join('\n\n')
    : '';

  const catalogSummary =
    catalogReply?.catalog?.type === 'overview'
      ? formatOverviewCatalog(catalogReply.catalog)
      : formatCatalogItems(catalogReply?.catalog);

  const deterministicHints = [supportReply?.reply, catalogReply?.reply]
    .filter(Boolean)
    .map((entry, index) => `${index + 1}. ${entry}`)
    .join('\n');

  return `
You are a store assistant for a Shopify storefront.
Answer in English only.
Use only the provided store context. Do not invent facts, prices, stock, policies, product specs, or tracking information.
If the exact answer is not available in context, say that clearly and suggest the closest useful next step.
Keep the answer customer-friendly and concise, usually 2 to 5 sentences.
If the question is about products, prefer matching by product descriptions and titles together.
If multiple products match, mention the best few matches.
If the question is about a policy, summarize the actual policy content from context.
Never mention Gemini, prompts, internal context, scraping, or configuration details.

Customer question:
${message}

Detected shop:
${shopDomain || supportConfig.storeUrl || 'Unknown'}

Saved store details:
${supportSummary || 'No saved store details available.'}

Deterministic assistant hints:
${deterministicHints || 'No deterministic hint available.'}

Catalog context:
${catalogSummary || 'No direct catalog matches were found.'}

Store page excerpts:
${pageSummary || 'No page excerpts were available.'}
`.trim();
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .map((part) => firstText(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim();

  return text || null;
}

async function createGeminiReply({ message, shopDomain, primaryIntent }) {
  const gemini = getGeminiConfig(shopDomain);

  if (!gemini) {
    return null;
  }

  const startedAt = Date.now();
  const supportConfig = getSupportConfig(shopDomain);
  const supportReply = createSupportReply({ message, shopDomain });

  let catalogReply = null;

  if (primaryIntent !== 'support') {
    try {
      catalogReply = await createCatalogReply({ message, shopDomain });
    } catch (error) {
      logger.warn('Catalog context lookup failed before Gemini request', {
        message: error.message,
        shopDomain,
      });
    }
  }

  const storeKnowledge = await getStoreKnowledge(shopDomain);
  const prompt = buildPrompt({
    message,
    shopDomain,
    supportReply,
    supportConfig,
    catalogReply,
    storeKnowledge,
  });

  try {
    const response = await axios.post(
      `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(gemini.model)}:generateContent?key=${encodeURIComponent(gemini.apiKey)}`,
      {
        systemInstruction: {
          parts: [
            {
              text: 'You are a grounded Shopify storefront assistant. Answer in English only and only from the provided store context.',
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 280,
        },
      },
      {
        timeout: gemini.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const reply = extractGeminiText(response.data);

    if (!reply) {
      return null;
    }

    logger.info('Gemini reply generated', {
      shopDomain,
      durationMs: Date.now() - startedAt,
      usedCatalogContext: Boolean(catalogReply?.catalog),
      usedStoreKnowledge: Boolean(storeKnowledge?.pages?.length),
    });

    return {
      success: true,
      source: 'gemini',
      intent:
        (catalogReply && catalogReply.intent !== 'catalog_not_configured' && catalogReply.intent) ||
        supportReply?.intent ||
        'ai_assistant',
      reply,
      suggestions:
        catalogReply?.suggestions ||
        supportReply?.suggestions ||
        DEFAULT_CATALOG_SUGGESTIONS,
      catalog:
        catalogReply && catalogReply.intent !== 'catalog_not_configured' ? catalogReply.catalog : null,
    };
  } catch (error) {
    logger.warn('Gemini request failed', {
      shopDomain,
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
}

module.exports = {
  createGeminiReply,
};
