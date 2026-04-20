const { getAdminSettingsView, saveStoreSettings, validateShopDomainOrThrow } = require('../services/storeSettings');
const { HttpError } = require('../utils/httpError');

function getRequestedShopDomain(req) {
  return req.query.shop || req.body?.shopDomain || req.body?.shop || req.body?.shop_domain || '';
}

function getStoreSettingsForAdmin(req, res, next) {
  try {
    const shopDomain = validateShopDomainOrThrow(getRequestedShopDomain(req));
    const payload = getAdminSettingsView(shopDomain);

    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

function validateSettingsPayload(payload = {}) {
  const maxLengths = {
    shiprocketEmail: 320,
    shiprocketPassword: 200,
    storefrontAccessToken: 400,
    geminiApiKey: 400,
    storeName: 120,
    supportEmail: 320,
    supportPhone: 40,
    supportWhatsapp: 40,
    supportHours: 160,
    shippingPolicy: 1000,
    returnPolicy: 1000,
    codPolicy: 500,
    cancellationPolicy: 500,
    orderProcessingTime: 250,
    contactUrl: 500,
    aboutText: 1000,
  };

  Object.entries(maxLengths).forEach(([field, maxLength]) => {
    const value = payload[field];

    if (typeof value === 'string' && value.trim().length > maxLength) {
      throw new HttpError(
        400,
        `${field} is too long.`,
        'INVALID_SETTINGS_INPUT',
      );
    }
  });
}

function saveStoreSettingsFromAdmin(req, res, next) {
  try {
    const shopDomain = validateShopDomainOrThrow(getRequestedShopDomain(req));
    const settings = req.body?.settings;

    if (!settings || typeof settings !== 'object') {
      throw new HttpError(
        400,
        'Settings payload is required.',
        'INVALID_SETTINGS_INPUT',
      );
    }

    validateSettingsPayload(settings);

    const saved = saveStoreSettings(shopDomain, settings);

    res.json({
      success: true,
      message: 'Settings saved successfully.',
      ...getAdminSettingsView(saved.shopDomain),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getStoreSettingsForAdmin,
  saveStoreSettingsFromAdmin,
};
