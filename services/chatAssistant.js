const { fetchTracking } = require('./shiprocket');
const { createGeminiReply } = require('./geminiAssistant');
const { DEFAULT_CATALOG_SUGGESTIONS, analyzeCatalogMessage } = require('./shopifyCatalog');

function normalizeMessage(message) {
  return String(message || '').trim();
}

function toComparableText(message) {
  return normalizeMessage(message)
    .toLowerCase()
    .replace(/[^a-z0-9#/_-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDigits(value) {
  return /\d/.test(value);
}

const TRACKING_KEYWORDS = [
  'track',
  'tracking',
  'awb',
  'shipment',
  'courier',
  'where is my order',
  'order status',
  'parcel',
  'delivery status',
  'consignment',
  'tracking batao',
  'status batao',
  'kahan hai',
  'kaha hai',
  'kab milega',
  'kidhar hai',
  'mera order',
  'my order',
  'latest update',
];

const SUPPORT_KEYWORDS = [
  'shipping',
  'delivery',
  'returns',
  'refund',
  'exchange',
  'replacement',
  'payment',
  'cod',
  'cash on delivery',
  'contact',
  'support',
  'customer care',
  'phone',
  'email',
  'whatsapp',
  'cancel',
  'cancellation',
  'address change',
  'change address',
  'about',
  'brand',
  'store details',
];

const CATALOG_KEYWORDS = [
  'product',
  'products',
  'collection',
  'collections',
  'category',
  'categories',
  'catalog',
  'price',
  'cost',
  'stock',
  'available',
  'availability',
  'buy',
  'shop',
  'show',
  'find',
  'recommend',
  'suggest',
  'best',
  'popular',
  'trending',
  'latest',
  'new arrival',
  'new arrivals',
  't-shirt',
  't shirt',
  'tshirt',
  'shirt',
  'tee',
  'hoodie',
  'cap',
  'frame',
  'frames',
  'sunglasses',
  'ashtray',
  'tray',
  'cone',
  'cones',
  'filter',
  'filters',
  'paper',
  'papers',
  'material',
  'materials',
  'contains',
  'contain',
  'made of',
  'feature',
  'features',
  'benefit',
  'benefits',
  'compare',
  'difference',
  'size',
  'sizes',
  'colour',
  'color',
  'fabric',
  'cotton',
  'gsm',
];

const CATALOG_QUESTION_PATTERNS = [
  /\b(give me|show me|find me|tell me about|details about|more about)\b/i,
  /\b(contains|contain|made of|material|fabric|gsm|feature|features|benefit|benefits)\b/i,
  /\b(compare|difference|best|popular|trending|latest)\b/i,
  /\b(which|what|do you have|have you got)\b/i,
  /\b(t-?shirt|shirt|tee|hoodie|cap|frame|frames|sunglasses|ashtray|tray|cone|cones|filter|filters|paper|papers)\b/i,
];

function buildResponse({
  success = true,
  source,
  intent,
  reply,
  suggestions = DEFAULT_CATALOG_SUGGESTIONS,
  tracking = null,
  catalog = null,
}) {
  return {
    success,
    source,
    intent,
    reply,
    suggestions: [...new Set((suggestions || []).filter(Boolean))].slice(0, 4),
    ...(tracking ? { tracking } : {}),
    ...(catalog ? { catalog } : {}),
  };
}

function extractStandaloneReference(message) {
  const trimmed = normalizeMessage(message);

  if (/^[A-Za-z0-9-]{6,40}$/.test(trimmed) && hasDigits(trimmed)) {
    return trimmed;
  }

  return null;
}

function extractExplicitOrderId(message) {
  const match = normalizeMessage(message).match(
    /(?:order(?:\s*(?:id|no|number))?)\s*[:#-]?\s*([A-Za-z0-9#/_-]{1,100})/i,
  );

  return match ? match[1] : null;
}

function extractLabeledAwb(message) {
  const match = normalizeMessage(message).match(
    /(?:awb|tracking(?:\s*(?:id|no|number))?|shipment(?:\s*(?:id|no|number))?)\s*[:#-]?\s*([A-Za-z0-9-]{6,40})/i,
  );

  return match && hasDigits(match[1]) ? match[1] : null;
}

function extractGenericTrackingToken(message) {
  const tokens = normalizeMessage(message).match(/[A-Za-z0-9-]{6,40}/g) || [];
  return tokens.find((token) => hasDigits(token)) || null;
}

function detectSmallTalk(message) {
  const text = toComparableText(message);

  if (/(^|\s)(thanks|thank you|thx|shukriya)(\s|$)/.test(text)) {
    return 'thanks';
  }

  if (/(^|\s)(hi|hello|hey|namaste|hii)(\s|$)/.test(text)) {
    return 'greeting';
  }

  return null;
}

function countKeywordHits(text, keywords) {
  return keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0);
}

function classifyMessage(message) {
  const smallTalk = detectSmallTalk(message);
  if (smallTalk === 'greeting') return 'greeting';
  if (smallTalk === 'thanks') return 'thanks';

  const text = toComparableText(message);
  const trackingScore = countKeywordHits(text, TRACKING_KEYWORDS);
  const supportScore = countKeywordHits(text, SUPPORT_KEYWORDS);
  const catalogScore = countKeywordHits(text, CATALOG_KEYWORDS);
  const catalogRequest = analyzeCatalogMessage(message);
  const hasCatalogQuestionPattern = CATALOG_QUESTION_PATTERNS.some((pattern) =>
    pattern.test(message),
  );

  const hasReference =
    Boolean(extractExplicitOrderId(message)) ||
    Boolean(extractLabeledAwb(message)) ||
    Boolean(extractStandaloneReference(message)) ||
    Boolean(extractGenericTrackingToken(message));

  if (hasReference || trackingScore > Math.max(supportScore, catalogScore)) {
    return 'tracking';
  }

  if (
    (catalogRequest.searchTerm || catalogScore > 0) &&
    (
      catalogRequest.wantsStoreOverview ||
      catalogRequest.wantsRecommendations ||
      catalogRequest.wantsPrice ||
      catalogRequest.wantsAvailability ||
      catalogRequest.wantsDetails ||
      catalogRequest.prefersCollections
    ) &&
    supportScore === 0
  ) {
    return 'catalog';
  }

  if (
    catalogRequest.searchTerm &&
    /\b(t-?shirt|shirt|tee|hoodie|cap|frame|frames|sunglasses|ashtray|tray|cone|cones|filter|filters|paper|papers)\b/.test(
      text,
    )
  ) {
    return 'catalog';
  }

  if (
    catalogRequest.searchTerm &&
    catalogRequest.searchTerm.split(/\s+/).length >= 2 &&
    !/\b(store|brand|about us|who are you|contact|support|customer care|privacy|refund|return|exchange|shipping|delivery|terms|payment|cod|cancel|cancellation)\b/.test(
      text,
    )
  ) {
    return 'catalog';
  }

  if (hasCatalogQuestionPattern && (catalogRequest.searchTerm || catalogScore > 0)) {
    return 'catalog';
  }

  if (supportScore > Math.max(trackingScore, catalogScore)) {
    return 'support';
  }

  if (catalogScore > 0) {
    return 'catalog';
  }

  // Short message with a product-like search term and no other intent → treat as catalog search
  if (
    catalogRequest.searchTerm &&
    supportScore === 0 &&
    !hasReference &&
    !/\b(store|brand|about us|who are you|contact|support|customer care|privacy|refund|return|exchange|shipping|delivery|terms|payment|cod|cancel|cancellation|help)\b/.test(text)
  ) {
    return 'catalog';
  }

  return 'fallback';
}

function isLikelyTrackingMessage(message) {
  const text = toComparableText(message);
  return TRACKING_KEYWORDS.some((keyword) => text.includes(keyword));
}

async function tryTrackingCandidates(candidates) {
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const tracking = await fetchTracking(candidate);
      return { tracking, candidate };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

function buildTrackingSuggestions(status) {
  switch (status) {
    case 'delivered':
      return ['Track Your Order', 'Refund Policy', 'Privacy Policy', 'Terms of Service'];
    case 'out for delivery':
      return ['Track Your Order', 'Order ID Status', 'Refund Policy', 'Privacy Policy'];
    default:
      return ['Track Your Order', 'Check AWB Status', 'Refund Policy', 'Privacy Policy'];
  }
}

async function handleTrackingConversation(message) {
  const explicitOrderId = extractExplicitOrderId(message);
  const labeledAwb = extractLabeledAwb(message);
  const standaloneReference = extractStandaloneReference(message);
  const genericToken = extractGenericTrackingToken(message);

  const shouldTrack =
    explicitOrderId ||
    labeledAwb ||
    standaloneReference ||
    (isLikelyTrackingMessage(message) && genericToken);

  if (!shouldTrack) {
    if (isLikelyTrackingMessage(message)) {
      return buildResponse({
        source: 'faq',
        intent: 'tracking',
        reply:
          'Send your AWB number or order ID and I will check the latest shipment status for you. Example: AWB 123456789 or Order ID 100001.',
        suggestions: ['Track Your Order', 'Check AWB Status', 'Refund Policy', 'Privacy Policy'],
      });
    }

    return null;
  }

  const candidates = [];

  if (explicitOrderId) {
    candidates.push({ orderId: explicitOrderId });
  }

  if (labeledAwb) {
    candidates.push({ awb: labeledAwb });
  }

  if (standaloneReference && !candidates.length) {
    candidates.push({ awb: standaloneReference });
    candidates.push({ orderId: standaloneReference });
  }

  if (genericToken && !candidates.length) {
    candidates.push({ awb: genericToken });
    candidates.push({ orderId: genericToken });
  }

  try {
    const result = await tryTrackingCandidates(candidates);

    if (!result) {
      return buildResponse({
        success: false,
        source: 'tracking',
        intent: 'tracking',
        reply: 'I could not find that shipment. Please recheck the AWB number or order ID and try again.',
        suggestions: ['Track Your Order', 'Check AWB Status', 'Refund Policy', 'Privacy Policy'],
      });
    }

    return buildResponse({
      source: 'tracking',
      intent: 'tracking',
      reply: result.tracking.reply,
      suggestions: buildTrackingSuggestions(result.tracking.status),
      tracking: {
        awb: result.tracking.awb,
        order_id: result.tracking.order_id,
        status: result.tracking.status,
        last_location: result.tracking.last_location,
        expected_delivery: result.tracking.expected_delivery,
        courier_name: result.tracking.courier_name,
        latest_event: result.tracking.latest_event,
        last_update_at: result.tracking.last_update_at,
        track_url: result.tracking.track_url,
        recent_updates: result.tracking.recent_updates,
      },
    });
  } catch (error) {
    if (error.code === 'INVALID_AWB' || error.code === 'INVALID_ORDER_ID') {
      return buildResponse({
        success: false,
        source: 'tracking',
        intent: 'tracking',
        reply: 'I could not find that shipment. Please recheck the AWB number or order ID and try again.',
        suggestions: ['Track Your Order', 'Check AWB Status', 'Refund Policy', 'Privacy Policy'],
      });
    }

    return buildResponse({
      success: false,
      source: 'tracking',
      intent: 'tracking',
      reply: "I couldn't fetch a live courier update right now. Please try again in a few minutes.",
      suggestions: ['Track Your Order', 'Check AWB Status', 'Order ID Status', 'Refund Policy'],
    });
  }
}

async function createChatReply({ message, shopDomain, history }) {
  const primaryIntent = classifyMessage(message);

  // 1) Tracking always first — deterministic, never goes to Gemini
  const trackingReply = await handleTrackingConversation(message);
  if (trackingReply) {
    return trackingReply;
  }

  // 2) All other intents handled by Gemini with full store context + history
  const geminiReply = await createGeminiReply({
    message,
    shopDomain,
    primaryIntent,
    history: Array.isArray(history) ? history : [],
  });

  if (geminiReply) {
    return buildResponse(geminiReply);
  }

  // 3) Final hard fallback
  return buildResponse({
    success: true,
    source: 'faq',
    intent: 'assistant_fallback',
    reply:
      'I can help with live tracking, store policies, products, and collections. Send an AWB number, order ID, product keyword, collection name, or your store question directly.',
    suggestions: ['Track Your Order', 'Refund Policy', 'Privacy Policy', 'Terms of Service'],
  });
}

module.exports = {
  createChatReply,
};