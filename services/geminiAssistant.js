const axios = require('axios');

const logger = require('../utils/logger');
const {
  DEFAULT_CATALOG_SUGGESTIONS,
  analyzeCatalogMessage,
  createCatalogReply,
} = require('./shopifyCatalog');
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

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDescriptionHighlights(text, maxItems = 3) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((sentence) => truncate(sentence, 220));
}

function detectReplyLanguage(message) {
  const text = String(message || '').trim().toLowerCase();

  if (!text) {
    return 'english';
  }

  const hinglishMarkers = [
    'hai',
    'kya',
    'mera',
    'mujhe',
    'batao',
    'bhai',
    'kab',
    'kidhar',
    'kaise',
    'kar do',
    'karna',
    'mil gaya',
    'nahi',
    'haan',
    'namaste',
    'shukriya',
  ];

  const matched = hinglishMarkers.filter((word) => text.includes(word)).length;

  if (matched >= 2) {
    return 'hinglish';
  }

  return 'english';
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
      const descriptionHighlights = extractDescriptionHighlights(item.description, 2);
      const parts = [
        `${index + 1}. ${item.title || 'Untitled item'}`,
        item.price ? `Price: ${item.price}` : null,
        typeof item.available === 'boolean'
          ? `Availability: ${item.available ? 'In stock' : 'Out of stock'}`
          : null,
        item.vendor ? `Brand: ${item.vendor}` : null,
        item.productType ? `Type: ${item.productType}` : null,
        Array.isArray(item.collections) && item.collections.length
          ? `Collections: ${item.collections.slice(0, 3).join(', ')}`
          : null,
        descriptionHighlights.length
          ? `Description highlights: ${descriptionHighlights.join(' | ')}`
          : null,
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
          .map((item, index) => {
            const highlights = extractDescriptionHighlights(item.description, 1);
            return [
              `${index + 1}. ${item.title}${item.price ? ` | ${item.price}` : ''}`,
              highlights.length ? `Description: ${highlights.join(' ')}` : null,
            ]
              .filter(Boolean)
              .join(' | ');
          })
          .join('\n')}`
      : null,
    collections.length
      ? `Collections:\n${collections
          .slice(0, 4)
          .map((item, index) => {
            const highlights = extractDescriptionHighlights(item.description, 1);
            return [
              `${index + 1}. ${item.title}${item.url ? ` | ${item.url}` : ''}`,
              highlights.length ? `Description: ${highlights.join(' ')}` : null,
            ]
              .filter(Boolean)
              .join(' | ');
          })
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatCatalogCardContext(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    return 'No catalog card should be attached unless the answer is directly about products or collections.';
  }

  if (catalog.type === 'overview') {
    return 'Attach the overview catalog card because the user asked about the store catalog broadly.';
  }

  if (Array.isArray(catalog.items) && catalog.items.length) {
    return `Attach the ${catalog.type} catalog card with the matched items already provided by backend.`;
  }

  return 'Do not imply catalog matches that are not present in the supplied context.';
}

function formatRequestIntentSummary(message) {
  const request = analyzeCatalogMessage(message);
  const parts = [
    request.searchTerm ? `Search term: ${request.searchTerm}` : null,
    request.wantsRecommendations ? 'User wants recommendations.' : null,
    request.wantsDetails ? 'User wants descriptive details.' : null,
    request.wantsPrice ? 'User cares about price.' : null,
    request.wantsAvailability ? 'User cares about availability.' : null,
    request.wantsCollections ? 'Collections may be relevant.' : null,
    request.prefersCollections ? 'Prefer collection-first answer if matches are strong.' : null,
  ].filter(Boolean);

  return parts.length ? parts.join(' ') : 'No additional parsed catalog intent.';
}

function buildPrompt({
  message,
  primaryIntent,
  supportConfig,
  catalogReply,
  storeKnowledge,
  replyLanguage,
}) {
  const storeDetails = [
    supportConfig.storeName ? `Store: ${supportConfig.storeName}` : null,
    supportConfig.supportEmail ? `Email: ${supportConfig.supportEmail}` : null,
    supportConfig.supportPhone ? `Phone: ${supportConfig.supportPhone}` : null,
    supportConfig.supportWhatsapp ? `WhatsApp: ${supportConfig.supportWhatsapp}` : null,
    supportConfig.supportHours ? `Hours: ${supportConfig.supportHours}` : null,
    supportConfig.shippingPolicy ? `Shipping: ${truncate(supportConfig.shippingPolicy, 280)}` : null,
    supportConfig.returnPolicy ? `Returns: ${truncate(supportConfig.returnPolicy, 280)}` : null,
    supportConfig.codPolicy ? `Payment: ${truncate(supportConfig.codPolicy, 200)}` : null,
    supportConfig.cancellationPolicy ? `Cancellation: ${truncate(supportConfig.cancellationPolicy, 200)}` : null,
    supportConfig.aboutText ? `About: ${truncate(supportConfig.aboutText, 280)}` : null,
    supportConfig.storeUrl ? `Store URL: ${supportConfig.storeUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const catalogContext =
    catalogReply?.catalog?.type === 'overview'
      ? formatOverviewCatalog(catalogReply.catalog)
      : formatCatalogItems(catalogReply?.catalog);

  const pageContext = Array.isArray(storeKnowledge?.pages)
    ? storeKnowledge.pages
        .slice(0, 4)
        .map((page) => `${page.name}${page.url ? ` (${page.url})` : ''}: ${truncate(page.snippet, 400)}`)
        .join('\n')
    : '';

  const intentGuide = {
    greeting: 'Greet warmly. In one sentence mention what you can help with (tracking, products, policies). Do not list products.',
    thanks: 'Thank them warmly and invite them to ask anything else. Keep it to 1-2 sentences.',
    tracking: 'Ask the customer for their AWB number or order ID to check live status.',
    catalog: 'Find the best matching products from the catalog context. Mention name, price, availability. List up to 3 if multiple match.',
    support: 'Answer the policy or support question directly using the store details. Quote or summarize the relevant policy.',
    fallback: 'Use all available context to give the most helpful answer. Be direct and brief.',
  };

  const languageGuide =
    replyLanguage === 'hinglish'
      ? 'Reply in simple Hinglish (Roman script). Keep product names, prices, and policy terms in English.'
      : 'Reply in friendly, natural English.';

  return `You are the store assistant for ${supportConfig.storeName || 'this store'}.

RULES (never break these):
- Answer ONLY from the context provided below. Never invent prices, stock, policies, or delivery dates.
- Write in plain text. No markdown, no ##, no **, no ---, no bullet symbols, no headers.
- Never copy-paste context into your reply. Read it, then write your own answer.
- Never mention AI, Gemini, prompts, or internal systems.
- Do not repeat the customer's question.
- Keep answers short: 1-4 sentences for simple questions, numbered list only when showing multiple products.
- ${languageGuide}

INTENT: ${primaryIntent || 'fallback'}
TASK: ${intentGuide[primaryIntent] || intentGuide.fallback}

CUSTOMER SAID: ${message}

STORE DETAILS:
${storeDetails || 'Not configured.'}

CATALOG:
${catalogContext || 'No matching products found.'}

STORE PAGES:
${pageContext || 'None.'}`.trim();
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
  const replyLanguage = detectReplyLanguage(message);

  const skipCatalog = primaryIntent === 'greeting' || primaryIntent === 'thanks';
  let catalogReply = null;

  if (!skipCatalog) {
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
    primaryIntent,
    supportConfig,
    catalogReply,
    storeKnowledge,
    replyLanguage,
  });

  try {
    const response = await axios.post(
      `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(gemini.model)}:generateContent?key=${encodeURIComponent(gemini.apiKey)}`,
      {
        systemInstruction: {
          parts: [
            {
              text:
                'You are the official store assistant. You have access to the store\'s full catalog, policies, and support details. Use only the supplied store context. Be helpful, friendly, and never invent facts.',
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
          temperature: 0.15,
          topP: 0.92,
          maxOutputTokens: 500,
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
      replyLanguage,
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
        catalogReply && catalogReply.intent !== 'catalog_not_configured'
          ? catalogReply.catalog
          : null,
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