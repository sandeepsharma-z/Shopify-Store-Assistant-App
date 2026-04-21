const { HttpError } = require('../utils/httpError');
const {
  getSettingsTokenSecret,
  isValidShopDomain,
  normalizeShopDomain,
  verifySettingsAccessToken,
} = require('../utils/shopify');

function extractShopDomain(req) {
  return normalizeShopDomain(
    req.query.shop || req.body?.shopDomain || req.body?.shop || req.body?.shop_domain || '',
  );
}

function hasEmbeddedAdminContext(req, shopDomain) {
  if (!shopDomain) return false;

  const embeddedInBody = String(req.body?.embedded || '') === '1';
  const embeddedInQuery = String(req.query?.embedded || '') === '1';
  const shopifyReferer = String(req.get('referer') || '').includes('admin.shopify.com');
  const hasHostParam = typeof req.query?.host === 'string' && Boolean(req.query.host.trim());

  return embeddedInBody || embeddedInQuery || shopifyReferer || hasHostParam;
}

function requireSettingsAccess(req, res, next) {
  const shopDomain = extractShopDomain(req);

  // Non-production: allow any request with a recognisable shop domain (or even without one)
  if (process.env.NODE_ENV !== 'production') {
    req.settingsAccess = { shopDomain: shopDomain || 'local' };
    next();
    return;
  }

  const secret = getSettingsTokenSecret();

  // Production without a secret configured: block all requests
  if (!secret) {
    next(
      new HttpError(
        401,
        'This settings request is not authorized. Open the app from Shopify admin and try again.',
        'SETTINGS_ACCESS_DENIED',
      ),
    );
    return;
  }

  // Try signed token first
  const token = req.get('x-settings-token') || req.body?.settingsToken || req.query.settingsToken;
  const payload = verifySettingsAccessToken(token, shopDomain);

  if (payload) {
    req.settingsAccess = payload;
    next();
    return;
  }

  // Fallback: valid Shopify shop domain + embedded admin indicators
  if (isValidShopDomain(shopDomain) && hasEmbeddedAdminContext(req, shopDomain)) {
    req.settingsAccess = { shopDomain, trustedEmbeddedAdmin: true };
    next();
    return;
  }

  next(
    new HttpError(
      401,
      'This settings request is not authorized. Open the app from Shopify admin and try again.',
      'SETTINGS_ACCESS_DENIED',
    ),
  );
}

module.exports = requireSettingsAccess;
