const { fetchTracking } = require('./shiprocket');
const { DEFAULT_CATALOG_SUGGESTIONS, createCatalogReply } = require('./shopifyCatalog');
const { createSupportReply } = require('./storeSupport');

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
    suggestions: [...new Set(suggestions.filter(Boolean))].slice(0, 4),
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

function isLikelyTrackingMessage(message) {
  const text = toComparableText(message);

  return [
    'track',
    'tracking',
    'awb',
    'shipment',
    'courier',
    'where is my order',
    'order status',
    'parcel',
    'status batao',
    'tracking batao',
    'kahan hai',
  ].some((keyword) => text.includes(keyword));
}

async function tryTrackingCandidates(candidates) {
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const tracking = await fetchTracking(candidate);

      return {
        tracking,
        candidate,
      };
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
      return ['Track another order', 'Find products', 'Browse collections', 'Shipping policy'];
    case 'out for delivery':
      return ['Track another order', 'Order ID status', 'Find products', 'Browse collections'];
    default:
      return ['Track another order', 'Check AWB status', 'Find products', 'Browse collections'];
  }
}

async function handleTrackingConversation(message) {
  const explicitOrderId = extractExplicitOrderId(message);
  const labeledAwb = extractLabeledAwb(message);
  const standaloneReference = extractStandaloneReference(message);
  const genericToken = extractGenericTrackingToken(message);
  const shouldTrack =
    explicitOrderId || labeledAwb || standaloneReference || (isLikelyTrackingMessage(message) && genericToken);

  if (!shouldTrack) {
    if (isLikelyTrackingMessage(message)) {
      return buildResponse({
        source: 'faq',
        intent: 'tracking',
        reply:
          'Send your AWB number or order ID and I will check the latest shipment status for you. Example: AWB 123456789 or Order ID 100001.',
        suggestions: ['Track my order', 'Check AWB status', 'Order ID status', 'Browse collections'],
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
        suggestions: ['Track my order', 'Check AWB status', 'Order ID status', 'Browse collections'],
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
        suggestions: ['Track my order', 'Check AWB status', 'Order ID status', 'Browse collections'],
      });
    }

    return buildResponse({
      success: false,
      source: 'tracking',
      intent: 'tracking',
      reply: "I couldn't fetch a live courier update right now. Please try again in a few minutes.",
      suggestions: ['Track my order', 'Check AWB status', 'Order ID status', 'Shipping policy'],
    });
  }
}

async function createChatReply({ message, shopDomain }) {
  const trackingReply = await handleTrackingConversation(message);

  if (trackingReply) {
    return trackingReply;
  }

  const smallTalkIntent = detectSmallTalk(message);

  if (smallTalkIntent === 'greeting') {
    return buildResponse({
      source: 'faq',
      intent: 'greeting',
      reply:
        'Hi there. I can help with live order tracking, product search, collection discovery, price checks, stock availability, shipping questions, returns, payments, and store contact details. Send your AWB number, order ID, product keyword, or question directly.',
    });
  }

  if (smallTalkIntent === 'thanks') {
    return buildResponse({
      source: 'faq',
      intent: 'thanks',
      reply:
        'Happy to help. Send another AWB number, order ID, product keyword, collection name, or support question whenever you need.',
    });
  }

  const supportReply = createSupportReply({
    message,
    shopDomain,
  });

  if (supportReply) {
    return buildResponse(supportReply);
  }

  let catalogReply;

  try {
    catalogReply = await createCatalogReply({
      message,
      shopDomain,
    });
  } catch (error) {
    return buildResponse({
      success: false,
      source: 'catalog',
      intent: 'catalog_lookup_failed',
      reply:
        'I could not load the store catalog right now. Please try again in a moment, or send an AWB number for live tracking.',
      suggestions: ['Track my order', 'Browse collections', 'Find products', 'Shipping policy'],
    });
  }

  if (catalogReply.intent === 'catalog_not_configured') {
    return buildResponse({
      success: true,
      source: 'faq',
      intent: 'assistant_fallback',
      reply:
        'I can help with live shipment tracking right now. For products and collections, connect SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN on the backend. You can also ask about shipping, returns, payments, and support details.',
      suggestions: ['Track my order', 'Check AWB status', 'Shipping policy', 'Contact support'],
    });
  }

  return buildResponse(catalogReply);
}

module.exports = {
  createChatReply,
};
