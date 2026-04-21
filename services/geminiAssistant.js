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
  shopDomain,
  primaryIntent,
  supportReply,
  supportConfig,
  catalogReply,
  storeKnowledge,
  replyLanguage,
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
            `${index + 1}. ${page.name}${page.url ? ` (${page.url})` : ''}\nTitle: ${page.title || page.name}\nExcerpt: ${truncate(page.snippet, 560)}`,
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

  const intentGuide = {
    greeting:
      'The customer is greeting you. Reply warmly, introduce what you can help with (order tracking, products, collections, policies, support), and invite them to ask anything.',
    thanks:
      'The customer is thanking you. Respond warmly and invite them to ask anything else they need.',
    tracking:
      'Tracking questions must stay strictly grounded in backend tracking data. If no tracking payload exists here, ask the customer to share their AWB number or order ID.',
    catalog:
      'Answer using the catalog context below. Mention specific product names, prices, and availability. If multiple items match, briefly list the best ones.',
    support:
      'Answer from the saved store details and scraped store pages only. Summarize the actual policy wording. Give contact details if available.',
    fallback:
      'Use all available store context — catalog, policies, and support details — to give the most helpful answer possible. Keep it brief and direct.',
  };

  const languageGuide =
    replyLanguage === 'hinglish'
      ? 'Reply in simple Hinglish using Roman script. Keep product names, policy names, prices, and technical terms in English.'
      : 'Reply in natural, friendly English.';

  return `
You are the official store assistant for ${supportConfig.storeName || 'this Shopify store'}.
Use ONLY the supplied store context to answer. Do not invent prices, stock status, policies, discounts, or delivery dates.
If the exact answer is not in the context, say so clearly and suggest the nearest helpful option.
Never mention Gemini, AI, prompts, scraping, backend systems, or internal configuration.
Do not repeat the customer's question back to them.
Never copy-paste or dump the store context, catalog data, or page excerpts into your reply. Use them only as reference to write your own natural answer.
Sound like a friendly, knowledgeable store team member — not a robot.

Reply style: ${languageGuide}

Primary intent: ${primaryIntent || 'fallback'}
Guidance: ${intentGuide[primaryIntent] || intentGuide.fallback}

Parsed request notes:
${formatRequestIntentSummary(message)}

Customer message:
${message}

--- STORE DETAILS ---
${supportSummary || 'No saved store details configured.'}

--- CATALOG CONTEXT ---
${catalogSummary || 'No catalog matches found for this query.'}

--- CATALOG CARD GUIDANCE ---
${formatCatalogCardContext(catalogReply?.catalog)}

--- STORE PAGE EXCERPTS ---
${pageSummary || 'No page excerpts available.'}

--- DETERMINISTIC HINTS ---
${deterministicHints || 'None.'}

Formatting rules (strictly follow):
- Plain text only. No markdown — no ##, ###, **, *, --, ---, >, bullet points, or any symbols.
- No section headers, no dividers, no bold/italic.
- If listing products, write them as a numbered plain-text list: "1. Product Name — Price — availability note."
- Keep responses concise — 2 to 5 sentences unless listing multiple products.

Response rules:
1. Give a direct answer first — no preamble like "Based on the context" or "Sure!".
2. For product queries: mention product name, price, availability, and a key feature if present.
3. For policy queries: summarize the actual policy from context in plain sentences.
4. For greetings: be warm, mention 3-4 things you can help with in one sentence, invite a question.
5. For unclear queries: use whatever context is available and offer a helpful next step.
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
    shopDomain,
    primaryIntent,
    supportReply,
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