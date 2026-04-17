const { buildRuntimeSettings } = require('./storeSettings');

function firstText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toComparableText(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildStoreUrl(shopDomain) {
  const normalized = firstText(shopDomain || process.env.SHOPIFY_STORE_DOMAIN || '');

  if (!normalized) {
    return null;
  }

  return `https://${normalized.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
}

function getSupportConfig(shopDomain) {
  const runtime = buildRuntimeSettings(shopDomain);

  return {
    storeName: runtime.storeName || 'our store',
    supportEmail: runtime.supportEmail,
    supportPhone: runtime.supportPhone,
    supportWhatsapp: runtime.supportWhatsapp,
    supportHours: runtime.supportHours,
    shippingPolicy: runtime.shippingPolicy,
    returnPolicy: runtime.returnPolicy,
    codPolicy: runtime.codPolicy,
    cancellationPolicy: runtime.cancellationPolicy,
    orderProcessingTime: runtime.orderProcessingTime,
    aboutText: runtime.aboutText,
    contactUrl: runtime.contactUrl,
    storeUrl: buildStoreUrl(runtime.shopDomain),
  };
}

function buildContactDetails(config) {
  const parts = [];

  if (config.supportEmail) {
    parts.push(`Email: ${config.supportEmail}`);
  }

  if (config.supportPhone) {
    parts.push(`Phone: ${config.supportPhone}`);
  }

  if (config.supportWhatsapp) {
    parts.push(`WhatsApp: ${config.supportWhatsapp}`);
  }

  if (config.supportHours) {
    parts.push(`Hours: ${config.supportHours}`);
  }

  if (config.contactUrl) {
    parts.push(`Contact page: ${config.contactUrl}`);
  } else if (config.storeUrl) {
    parts.push(`Store: ${config.storeUrl}`);
  }

  return parts;
}

function withTrailingPeriod(value) {
  const text = firstText(value);

  if (!text) {
    return null;
  }

  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function detectSupportIntent(message) {
  const text = toComparableText(message);

  if (!text) {
    return null;
  }

  if (
    /\b(help|what can you do|how can you help|menu|options|assist|assistant)\b/.test(text)
  ) {
    return 'help';
  }

  if (
    /\b(contact|support|customer care|phone|email|mail|whatsapp|call|reach you|talk to someone)\b/.test(
      text,
    )
  ) {
    return 'contact';
  }

  if (
    /\b(shipping|delivery|deliver|dispatch|shipment time|shipping policy|delivery policy|eta)\b/.test(
      text,
    )
  ) {
    return 'shipping';
  }

  if (/\b(return|refund|exchange|replacement|return policy|refund policy)\b/.test(text)) {
    return 'returns';
  }

  if (
    /\b(cod|cash on delivery|payment|upi|card|debit card|credit card|pay online|payment method)\b/.test(
      text,
    )
  ) {
    return 'payment';
  }

  if (
    /\b(cancel|cancellation|change address|address change|modify order|edit order)\b/.test(text)
  ) {
    return 'order_changes';
  }

  if (/\b(about|about us|who are you|brand|store info|store details)\b/.test(text)) {
    return 'about';
  }

  return null;
}

function createSupportReply({ message, shopDomain }) {
  const intent = detectSupportIntent(message);

  if (!intent) {
    return null;
  }

  const config = getSupportConfig(shopDomain);
  const contactDetails = buildContactDetails(config);
  const contactText = contactDetails.length
    ? ` ${contactDetails.join('. ')}.`
    : '';
  const suggestions = ['Find products', 'Browse collections', 'Track my order', 'Order help'];

  if (intent === 'help') {
    return {
      success: true,
      source: 'support',
      intent,
      reply:
        'I can help with product search, collection discovery, price and stock checks, live Shiprocket tracking by AWB or order ID, plus shipping, returns, payments, and store contact details.',
      suggestions,
    };
  }

  if (intent === 'contact') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: contactDetails.length
        ? `You can contact ${config.storeName}.${contactText}`
        : `Support contact details are not configured yet. You can still use this assistant for products, collections, and live shipment tracking.`,
      suggestions: ['Track my order', 'Find products', 'Browse collections', 'Shipping policy'],
    };
  }

  if (intent === 'shipping') {
    const shippingDetails = [config.shippingPolicy, config.orderProcessingTime]
      .filter(Boolean)
      .join(' ');

    return {
      success: true,
      source: 'support',
      intent,
      reply: shippingDetails
        ? `Shipping details: ${withTrailingPeriod(shippingDetails)} For a live shipment update, send your AWB number or order ID.${contactText}`
        : `For live delivery status, send your AWB number or order ID. General shipping details are not configured yet.${contactText}`,
      suggestions: ['Track my order', 'Check AWB status', 'Find products', 'Browse collections'],
    };
  }

  if (intent === 'returns') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: config.returnPolicy
        ? `Return and refund details: ${withTrailingPeriod(config.returnPolicy)}${contactText}`
        : `Return and refund policy details are not configured yet.${contactText}`,
      suggestions: ['Track my order', 'Find products', 'Browse collections', 'Contact support'],
    };
  }

  if (intent === 'payment') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: config.codPolicy
        ? `Payment details: ${withTrailingPeriod(config.codPolicy)}${contactText}`
        : `Payment method details are not configured yet.${contactText}`,
      suggestions: ['Find products', 'Browse collections', 'Track my order', 'Contact support'],
    };
  }

  if (intent === 'order_changes') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: config.cancellationPolicy
        ? `Order change or cancellation details: ${withTrailingPeriod(config.cancellationPolicy)}${contactText}`
        : `Order modification or cancellation details are not configured yet.${contactText}`,
      suggestions: ['Track my order', 'Order ID status', 'Contact support', 'Find products'],
    };
  }

  return {
    success: true,
    source: 'support',
    intent,
    reply: config.aboutText
      ? `${config.aboutText}${config.storeUrl ? ` Visit: ${config.storeUrl}.` : ''}`
      : `${config.storeName} is available here to help with products, collections, and live shipment updates.${config.storeUrl ? ` Store: ${config.storeUrl}.` : ''}`,
    suggestions,
  };
}

module.exports = {
  createSupportReply,
  detectSupportIntent,
  getSupportConfig,
};
