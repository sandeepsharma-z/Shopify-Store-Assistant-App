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

function requireSettingsAccess(req, res, next) {
  const secret = getSettingsTokenSecret();

  if (!secret && process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const token = req.get('x-settings-token') || req.body?.settingsToken || req.query.settingsToken;
  const shopDomain = extractShopDomain(req);
  const payload = verifySettingsAccessToken(token, shopDomain);

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
