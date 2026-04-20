const { HttpError } = require('../utils/httpError');
const {
  getSettingsTokenSecret,
  normalizeShopDomain,
  verifySettingsAccessToken,
} = require('../utils/shopify');

function extractShopDomain(req) {
  return normalizeShopDomain(
    req.query.shop || req.body?.shopDomain || req.body?.shop || req.body?.shop_domain || '',
  );
}

function hasEmbeddedAdminContext(req, shopDomain) {
  return Boolean(
    shopDomain &&
      typeof req.get('x-settings-token') === 'string' &&
      req.get('x-settings-token').trim() &&
      (String(req.body?.embedded || '') === '1' ||
        String(req.query?.embedded || '') === '1' ||
        String(req.get('referer') || '').includes('admin.shopify.com')),
  );
}

function requireSettingsAccess(req, res, next) {
  const secret = getSettingsTokenSecret();
  const shopDomain = extractShopDomain(req);

  if (!secret && process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const token = req.get('x-settings-token') || req.body?.settingsToken || req.query.settingsToken;
  const payload = verifySettingsAccessToken(token, shopDomain);

  if (!payload && hasEmbeddedAdminContext(req, shopDomain)) {
    req.settingsAccess = {
      shopDomain,
      trustedEmbeddedAdmin: true,
    };
    next();
    return;
  }

  if (!payload) {
    next(
      new HttpError(
        401,
        'This settings request is not authorized. Open the app from Shopify admin and try again.',
        'SETTINGS_ACCESS_DENIED',
      ),
    );
    return;
  }

  req.settingsAccess = payload;
  next();
}

module.exports = requireSettingsAccess;
