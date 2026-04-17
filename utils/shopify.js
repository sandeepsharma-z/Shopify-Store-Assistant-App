const crypto = require('crypto');

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function normalizeShopDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function isValidShopDomain(value) {
  const normalized = normalizeShopDomain(value);
  return SHOP_DOMAIN_PATTERN.test(normalized);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSortedQueryString(query) {
  return Object.keys(query || {})
    .filter((key) => key !== 'hmac' && key !== 'signature')
    .sort()
    .map((key) => {
      const value = Array.isArray(query[key]) ? query[key].join(',') : query[key];
      return `${key}=${value}`;
    })
    .join('&');
}

function verifyShopifyQueryHmac(query, secret) {
  const providedHmac = typeof query?.hmac === 'string' ? query.hmac : '';

  if (!providedHmac || !secret) {
    return false;
  }

  const message = buildSortedQueryString(query);
  const computedHmac = crypto.createHmac('sha256', secret).update(message).digest('hex');

  return safeCompare(providedHmac, computedHmac);
}

function getSettingsTokenSecret() {
  return (
    String(process.env.SETTINGS_ACCESS_SECRET || '').trim() ||
    String(process.env.SHOPIFY_API_SECRET || '').trim()
  );
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function createSettingsAccessToken({ shopDomain, ttlMs = 30 * 60 * 1000 } = {}) {
  const secret = getSettingsTokenSecret();

  if (!secret || !isValidShopDomain(shopDomain)) {
    return null;
  }

  const payload = {
    shopDomain: normalizeShopDomain(shopDomain),
    exp: Date.now() + ttlMs,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex');

  return `${encodedPayload}.${signature}`;
}

function verifySettingsAccessToken(token, shopDomain) {
  const secret = getSettingsTokenSecret();

  if (!secret || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }

  const [encodedPayload, providedSignature] = token.split('.');
  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex');

  if (!safeCompare(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload));

    if (!payload || payload.exp < Date.now()) {
      return null;
    }

    if (
      shopDomain &&
      normalizeShopDomain(payload.shopDomain) !== normalizeShopDomain(shopDomain)
    ) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

module.exports = {
  createSettingsAccessToken,
  getSettingsTokenSecret,
  isValidShopDomain,
  normalizeShopDomain,
  safeCompare,
  verifySettingsAccessToken,
  verifyShopifyQueryHmac,
};
