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

function applyStoreDefaults(config, shopDomain) {
  const normalizedShop = firstText(shopDomain || '')
    ?.toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  if (normalizedShop !== 'litaf.in') {
    return config;
  }

  return {
    ...config,
    supportEmail: config.supportEmail || 'info@litaf.in',
    supportWhatsapp: config.supportWhatsapp || '+91 82921 49219',
    shippingPolicy:
      config.shippingPolicy ||
      'Shipping is free for all domestic orders. Standard delivery usually takes 3 to 4 working days, while high-launch-demand orders may dispatch within 5 to 7 working days.',
    returnPolicy:
      config.returnPolicy ||
      'Free returns are available within 3 days. Jewellery, rugs, and frames are non-returnable unless damaged or incorrect. Sale items are final and not eligible for return or exchange.',
    codPolicy:
      config.codPolicy ||
      'Available payment options are shown at checkout. For payment-related help, contact the store support team.',
    cancellationPolicy:
      config.cancellationPolicy ||
      'If you need to change or cancel an order, contact support as early as possible before shipment processing starts.',
    privacyPolicy:
      config.privacyPolicy ||
      'Customer information is collected and used to process orders, improve the shopping experience, and provide support. Personal details are handled according to the store privacy practices.',
    termsOfService:
      config.termsOfService ||
      'By using the store, customers agree to the website terms, checkout terms, and order policies published by the store. Order acceptance, payment, and service availability remain subject to store policies.',
  };
}

function getSupportConfig(shopDomain) {
  const runtime = buildRuntimeSettings(shopDomain);
  const baseConfig = {
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
    privacyPolicy: runtime.privacyPolicy,
    termsOfService: runtime.termsOfService,
  };

  return applyStoreDefaults(baseConfig, runtime.shopDomain);
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

  return parts;
}

function withTrailingPeriod(value) {
  const text = firstText(value);

  if (!text) {
    return null;
  }

  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildStoreReference(config) {
  if (config.contactUrl) {
    return `You can also check ${config.contactUrl}.`;
  }

  if (config.storeUrl) {
    return `You can also visit ${config.storeUrl}.`;
  }

  return null;
}

function joinReplyParts(parts) {
  return parts.filter(Boolean).join(' ');
}

function resolveReturnsLabel(message) {
  const text = toComparableText(message);

  if (text.includes('refund')) {
    return 'Refund Policy';
  }

  return 'Returns & Exchange';
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
    /\b(privacy|privacy policy|data policy|data privacy)\b/.test(text)
  ) {
    return 'privacy';
  }

  if (
    /\b(terms|terms of service|terms of use|store terms)\b/.test(text)
  ) {
    return 'terms';
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
  const storeReference = buildStoreReference(config);
  const suggestions = ['Track Your Order', 'Refund Policy', 'Privacy Policy', 'Returns & Exchange'];

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
        : joinReplyParts([
            `You can use this assistant for products, collections, and live shipment tracking.`,
            storeReference,
          ]),
      suggestions: ['Track Your Order', 'Refund Policy', 'Privacy Policy', 'Returns & Exchange'],
    };
  }

  if (intent === 'privacy') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: `Privacy Policy: ${withTrailingPeriod(config.privacyPolicy)}${contactText}`,
      suggestions: ['Terms of Service', 'Refund Policy', 'Returns & Exchange', 'Track Your Order'],
    };
  }

  if (intent === 'terms') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: `Terms of Service: ${withTrailingPeriod(config.termsOfService)}${contactText}`,
      suggestions: ['Privacy Policy', 'Refund Policy', 'Returns & Exchange', 'Track Your Order'],
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
        ? `Track Your Order: ${withTrailingPeriod(shippingDetails)} For a live shipment update, send your AWB number or order ID.${contactText}`
        : joinReplyParts([
            'For a live delivery update, send your AWB number or order ID.',
            'General shipping timelines depend on the order, serviceability, and courier partner.',
            storeReference,
            contactText.trim(),
          ]),
      suggestions: ['Track Your Order', 'Refund Policy', 'Privacy Policy', 'Returns & Exchange'],
    };
  }

  if (intent === 'returns') {
    const returnsLabel = resolveReturnsLabel(message);

    return {
      success: true,
      source: 'support',
      intent,
      reply: config.returnPolicy
        ? `${returnsLabel}: ${withTrailingPeriod(config.returnPolicy)}${contactText}`
        : joinReplyParts([
            'Return and refund details are not available in the assistant right now.',
            'Please check the store policy page or contact support for the latest terms.',
            storeReference,
            contactText.trim(),
          ]),
      suggestions: ['Refund Policy', 'Privacy Policy', 'Terms of Service', 'Track Your Order'],
    };
  }

  if (intent === 'payment') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: config.codPolicy
        ? `Payment details: ${withTrailingPeriod(config.codPolicy)}${contactText}`
        : joinReplyParts([
            'Payment method details are not available in the assistant right now.',
            'Please check checkout options on the store or contact support for payment help.',
            storeReference,
            contactText.trim(),
          ]),
      suggestions: ['Track Your Order', 'Refund Policy', 'Privacy Policy', 'Terms of Service'],
    };
  }

  if (intent === 'order_changes') {
    return {
      success: true,
      source: 'support',
      intent,
      reply: config.cancellationPolicy
        ? `Order change or cancellation details: ${withTrailingPeriod(config.cancellationPolicy)}${contactText}`
        : joinReplyParts([
            'Order change or cancellation details are not available in the assistant right now.',
            'Please contact support as early as possible if you need help with an order update.',
            storeReference,
            contactText.trim(),
          ]),
      suggestions: ['Track Your Order', 'Refund Policy', 'Privacy Policy', 'Terms of Service'],
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
