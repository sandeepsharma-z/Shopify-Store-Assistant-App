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
  historyTurns,
}) {
  const hasCatalog =
    catalogReply &&
    catalogReply.intent !== 'catalog_not_configured' &&
    catalogReply.catalog;

  const storeName = supportConfig.storeName || 'this store';

  const storeDetails = [
    `Store name: ${storeName}`,
    supportConfig.storeUrl ? `Store URL: ${supportConfig.storeUrl}` : null,
    supportConfig.supportEmail ? `Support email: ${supportConfig.supportEmail}` : null,
    supportConfig.supportPhone ? `Support phone: ${supportConfig.supportPhone}` : null,
    supportConfig.supportWhatsapp ? `WhatsApp: ${supportConfig.supportWhatsapp}` : null,
    supportConfig.supportHours ? `Support hours: ${supportConfig.supportHours}` : null,
    supportConfig.shippingPolicy ? `Shipping policy: ${truncate(supportConfig.shippingPolicy, 400)}` : null,
    supportConfig.returnPolicy ? `Return/refund policy: ${truncate(supportConfig.returnPolicy, 400)}` : null,
    supportConfig.codPolicy ? `Payment/COD policy: ${truncate(supportConfig.codPolicy, 300)}` : null,
    supportConfig.cancellationPolicy ? `Cancellation policy: ${truncate(supportConfig.cancellationPolicy, 300)}` : null,
    supportConfig.aboutText ? `About the store: ${truncate(supportConfig.aboutText, 400)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const catalogContext = hasCatalog
    ? (catalogReply.catalog.type === 'overview'
        ? formatOverviewCatalog(catalogReply.catalog)
        : formatCatalogItems(catalogReply.catalog))
    : null;

  const pageContext = Array.isArray(storeKnowledge?.pages) && storeKnowledge.pages.length
    ? storeKnowledge.pages
        .slice(0, 5)
        .map((p) => `[${p.name}]${p.url ? ` — ${p.url}` : ''}\n${truncate(p.snippet, 500)}`)
        .join('\n\n')
    : null;

  // Include ALL conversation history, not just recent turns
  const recentContext = Array.isArray(historyTurns) && historyTurns.length
    ? historyTurns
        .map((t) => `${t.role === 'assistant' ? 'Assistant' : 'Customer'}: ${t.text}`)
        .join('\n')
    : null;

  const languageGuide =
    replyLanguage === 'hinglish'
      ? 'Reply in simple Hinglish (Roman script). Keep product names, prices, URLs, and policy terms in English.'
      : 'Reply in friendly, natural English.';

  return `You are the BEST store assistant for ${storeName}. You are brilliant at understanding EXACTLY what customers really want, even when they don't ask directly. You understand natural language, typos, misspellings, follow-up questions, partial names, casual phrasing, unclear messages, and implied requests.

YOUR SUPERPOWER:
- You READ BETWEEN THE LINES. If someone asks "what's this store about?" → you show top products and categories
- You ANTICIPATE what customers need. If they ask about price → also mention discounts, payment options, shipping
- You CONNECT THE DOTS. If they ask "how long to ship?" → you also offer tracking info
- You're CONVERSATIONAL and SMART. Every answer feels natural and helpful, not robotic
- You REMEMBER everything discussed and build on it
- You INTERPRET vague questions by looking at store context. "Got anything cool?" → mention trending/featured products

STRICT RULES:
1. Use ONLY the provided store context. Never invent products, prices, policies, stock status, or delivery dates.
2. Plain text only. No ##, **, *-, ---, bullets, or any markdown symbols.
3. Write your own natural answer. Never paste raw context.
4. Never reveal you are AI, Gemini, or any internal system.
5. Do not repeat the customer's question.
6. Length: 1-4 sentences for simple answers. Numbered list only for 2+ products.
7. ${languageGuide}
8. NEVER respond with "I don't understand", "unknown message", "unclear", or "can't help" — ALWAYS find a helpful answer.
9. For off-topic questions: politely acknowledge, then offer what you CAN help with. Example: "I don't have info on that, but I can help with our products, collections, tracking, policies, or shipping details!"
10. For unclear/garbled messages: GUESS the intent from context and history. Always try to provide a helpful answer, not ask for clarification.
11. For typos and misspellings: Automatically understand (e.g., "prodct" = "product", "prise" = "price", "availble" = "available", "shrit" = "shirt").
12. PROACTIVE HELPFULNESS: If asking about one product, mention related products. If asking about price, mention collections. Always add value.
13. For vague/minimal messages: Use conversation history to infer what they need. If no history, ask a helpful follow-up about products, tracking, or policies.

SPECIAL HANDLING BY INTENT TYPE:
If intent is 'greeting' (hi, hello, hey, namaste):
  → Respond with WARM 1-sentence hello. Don't sell products yet.
  → Examples: "Hey! Welcome to ${storeName}. How can I help you?" or "Hey there! Looking for something special?"

If intent is 'thanks' (thank you, thanks, shukriya):
  → Acknowledge warmly in 1 sentence, ask how else to help.
  → Examples: "You're welcome! Anything else I can find for you?" or "Happy to help! Need anything else?"

If intent is 'tracking' (track, awb, order status, shipment):
  → Look for AWB/Order ID and provide tracking info, or ask for it.
  → Be proactive with expected delivery date if available.

If intent is 'support' (shipping, returns, refund, cancel, contact):
  → Provide relevant policy from store details.
  → Be warm and helpful, not just rule-based.

If intent is 'catalog' (products, show me, find, price, available):
  → Show matching products with key details (price, availability, collections).
  → If no exact match, suggest related products.

If intent is 'fallback' (everything else):
  → ALWAYS make a best effort. Use conversation history + store context to guess.
  → Provide a helpful answer, suggest related topics, never say "I don't understand."

CUSTOMER'S CURRENT MESSAGE:
${message}

CONVERSATION SO FAR:
${recentContext || 'This is the first message.'}

HOW TO THINK:
- You are NOT a search engine. You are a SMART ASSISTANT who understands intent.
- Every question has a REAL INTENT behind it. Find it and answer intelligently.
- "do you have anything?" = "show me products" or "tell me what you sell"
- "how much?" = "price of the product discussed"
- "when?" = "how long to deliver" or "when available"

HOW TO USE CONVERSATION HISTORY:
- Read the FULL conversation above. This is YOUR MEMORY. Use it constantly.
- The customer may be continuing a topic from 5+ messages ago.
- If they say "price?" or "when?" or "available?" — know EXACTLY what they mean from context.
- If they reference "that one" or "this" — find which product from history.
- Use conversation flow to understand context and intent PERFECTLY.

INTERPRETATION RULES - HANDLE EVERYTHING:
Simple Words/Commands:
- "hi", "hello", "hey" → warm greeting
- "ok", "good", "alright" → acknowledge and ask how to help next
- "yes", "yeah", "yup" → positive acknowledgment; use context to continue
- "no", "nope" → negative response; help clarify what they need instead
- "show me", "give me", "find me" → search for products
- "got anything?", "what's new?" → show top/featured products
- "what's this?", "what is it?" → explanation + price + availability

Follow-ups (use conversation history):
- "how much?", "price?", "cost?" → price of last discussed product + payment options
- "tell me more", "details", "more info" → FULL details of previously discussed product
- "any other options?", "alternatives?" → SIMILAR products as alternatives
- "is it good?", "why this one?" → quality/benefits/why this product is good
- "when can I get it?", "delivery?", "shipping?" → shipping time + availability + tracking
- "how does it work?", "what's inside?", "features?" → description + features + benefits
- "which one?", "which is best?" → RECOMMENDATION based on context
- "same as before?", "like that?" → recall previous product from history

Unclear/Vague:
- Single words → use context to guess intent
- Typos/misspellings → auto-correct and answer
- Garbled text → parse carefully and provide best guess
- Questions without context → ask helpful follow-up about our products/tracking/policies
- Random commands → acknowledge and redirect to what you CAN help with

FINAL RULE: For ANY message type not explicitly listed above, GUESS the intent using full conversation history and provide a helpful answer. NEVER say "I don't understand."

EXECUTION CHECKLIST - DO THIS FOR EVERY MESSAGE:
1. Read FULL conversation history. Remember what was discussed.
2. DECODE: What does the customer REALLY want? (look past literal words)
3. Check what type of message this is:
   - Greeting? (hi, hello, hey) → respond with warm hello
   - Thank you? (thanks, shukriya) → acknowledge warmly
   - Product search? (show me X, find Y) → search catalog
   - Follow-up question? (how much, tell me more) → use context
   - Off-topic? (weather, politics, etc) → acknowledge then redirect
   - Vague/unclear? (single words, typos) → use context to guess intent
4. Find relevant products, prices, policies, stock info.
5. Build SMART answer: responds to their real intent + adds related value + suggests next step.
6. If no exact product match: still provide helpful info about similar products or relevant policies.
7. NEVER end with "I don't understand" or "unclear". Always provide a helpful response.

MOST IMPORTANT: Answer the INTENT, not just the LITERAL WORDS. Be conversational, helpful, and proactive. ALWAYS provide value.

DETECTED INTENT: ${primaryIntent || 'fallback'}

STORE DETAILS:
${storeDetails || 'Not configured.'}

CATALOG DATA:
${catalogContext || (catalogReply?.intent === 'catalog_not_configured'
    ? 'Catalog not connected — cannot answer live product/stock/price questions.'
    : 'No matching products or collections found for this query.')}

STORE PAGES:
${pageContext || 'None available.'}`.trim();
}

function extractTopicFromHistory(history) {
  // Walk all recent turns backwards (user + assistant) to find the last
  // product/collection/topic that was being discussed.
  const recentTurns = history.slice(-8).reverse();

  for (const turn of recentTurns) {
    if (turn.role === 'user') {
      const analyzed = analyzeCatalogMessage(turn.text);
      if (analyzed.searchTerm && analyzed.searchTerm.length > 2) {
        return analyzed.searchTerm;
      }
    }

    if (turn.role === 'assistant') {
      // Extract product/collection name from assistant reply patterns like:
      // "The best match is X." / "X is priced at..." / "X is in stock"
      const nameMatch = turn.text.match(
        /(?:best match(?:\s+is)?|here is|here are|found\s+|product(?:\s+is)?|collection(?:\s+is)?)\s+([A-Z][A-Za-z0-9\s()'&-]{2,60}?)(?:\.|,|\s+(?:is|at|for|–|-|—|priced|available))/,
      );
      if (nameMatch && nameMatch[1].trim().length > 2) {
        return nameMatch[1].trim();
      }
    }
  }

  return null;
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

async function createGeminiReply({ message, shopDomain, primaryIntent, history }) {
  const gemini = getGeminiConfig(shopDomain);

  if (!gemini) {
    return null;
  }

  const startedAt = Date.now();
  const supportConfig = getSupportConfig(shopDomain);
  const supportReply = createSupportReply({ message, shopDomain });
  const replyLanguage = detectReplyLanguage(message);

  const skipCatalog = primaryIntent === 'greeting' || primaryIntent === 'thanks';
  const historyTurns = Array.isArray(history) ? history : [];
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

    // If current message returned no catalog results (follow-up question with no product name),
    // look back through history to find the last product/topic the user asked about
    // and re-fetch catalog data for it so Gemini has the right context.
    const hasNoCatalogData =
      !catalogReply ||
      !catalogReply.catalog ||
      catalogReply.intent === 'catalog_not_configured' ||
      (Array.isArray(catalogReply.catalog?.items) && catalogReply.catalog.items.length === 0);

    if (hasNoCatalogData && historyTurns.length) {
      const lastTopic = extractTopicFromHistory(historyTurns);
      if (lastTopic) {
        try {
          catalogReply = await createCatalogReply({ message: lastTopic, shopDomain });
        } catch (_) {}
      }
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
    historyTurns,
  });

  const contents = [];

  // Add prior conversation turns so Gemini remembers context
  historyTurns.forEach(function addTurn(turn) {
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text }],
    });
  });

  // Current message with full store context prompt
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  try {
    const response = await axios.post(
      `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(gemini.model)}:generateContent?key=${encodeURIComponent(gemini.apiKey)}`,
      {
        systemInstruction: {
          parts: [
            {
              text: `You are a smart, patient, context-aware store assistant. You understand partial product names, follow-up questions, casual phrasing, typos, and unclear messages. Always try to understand the customer's real intent. Use only the supplied store context. Reason carefully about what the customer is really asking before answering. Never invent facts. Be helpful and friendly even when the customer's message is unclear, poorly written, or contains typos.`,
            },
          ],
        },
        contents,
        generationConfig: {
          temperature: 0.2,
          topP: 0.95,
          maxOutputTokens: 700,
          thinkingConfig: {
            thinkingBudget: 512,
          },
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

    // Only include catalog if there are actual items to display
    const hasCatalogItems = catalogReply?.catalog &&
      (
        (Array.isArray(catalogReply.catalog.items) && catalogReply.catalog.items.length > 0) ||
        (catalogReply.catalog.type === 'overview' && (
          (Array.isArray(catalogReply.catalog.products) && catalogReply.catalog.products.length > 0) ||
          (Array.isArray(catalogReply.catalog.collections) && catalogReply.catalog.collections.length > 0)
        ))
      );

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
      ...(hasCatalogItems ? { catalog: catalogReply.catalog } : {}),
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