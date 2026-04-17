const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { HttpError } = require('../utils/httpError');
const { isValidShopDomain, normalizeShopDomain } = require('../utils/shopify');
const logger = require('../utils/logger');

const SETTINGS_FIELDS = [
  'shiprocketEmail',
  'shiprocketPassword',
  'storefrontAccessToken',
  'storeName',
  'supportEmail',
  'supportPhone',
  'supportWhatsapp',
  'supportHours',
  'shippingPolicy',
  'returnPolicy',
  'codPolicy',
  'cancellationPolicy',
  'orderProcessingTime',
  'contactUrl',
  'aboutText',
];

const SENSITIVE_FIELDS = new Set(['shiprocketPassword', 'storefrontAccessToken']);

function firstText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getStoreSettingsFilePath() {
  const configuredPath = firstText(process.env.STORE_SETTINGS_FILE);

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  return path.join(process.cwd(), 'data', 'store-settings.json');
}

function ensureStoreSettingsDirectory() {
  const filePath = getStoreSettingsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}

function getEncryptionSecret() {
  const configuredSecret =
    firstText(process.env.SETTINGS_ENCRYPTION_KEY) ||
    firstText(process.env.SHOPIFY_API_SECRET);

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'local-dev-settings-secret';
  }

  return null;
}

function deriveEncryptionKey() {
  const secret = getEncryptionSecret();

  if (!secret) {
    throw new HttpError(
      500,
      'Settings encryption is not configured on the server.',
      'SETTINGS_ENCRYPTION_NOT_CONFIGURED',
    );
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function encryptValue(value) {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    value: encrypted.toString('base64'),
  };
}

function decryptValue(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const key = deriveEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64'),
  );

  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.value, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

function readStore() {
  const filePath = ensureStoreSettingsDirectory();

  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      shops: {},
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');

    if (!raw.trim()) {
      return {
        version: 1,
        shops: {},
      };
    }

    const parsed = JSON.parse(raw);

    return {
      version: 1,
      shops: parsed && typeof parsed.shops === 'object' && parsed.shops ? parsed.shops : {},
    };
  } catch (error) {
    logger.error('Failed to read store settings file', {
      filePath,
      message: error.message,
    });
    throw new HttpError(
      500,
      'Store settings could not be loaded right now.',
      'STORE_SETTINGS_READ_FAILED',
    );
  }
}

function writeStore(store) {
  const filePath = ensureStoreSettingsDirectory();

  try {
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    logger.error('Failed to write store settings file', {
      filePath,
      message: error.message,
    });
    throw new HttpError(
      500,
      'Store settings could not be saved right now.',
      'STORE_SETTINGS_WRITE_FAILED',
    );
  }
}

function validateShopDomainOrThrow(shopDomain) {
  const normalized = normalizeShopDomain(shopDomain);

  if (!isValidShopDomain(normalized)) {
    throw new HttpError(
      400,
      'A valid Shopify shop domain is required.',
      'INVALID_SHOP_DOMAIN',
    );
  }

  return normalized;
}

function normalizeIncomingSettings(payload = {}) {
  const normalized = {};

  SETTINGS_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      const value = firstText(payload[field]);
      normalized[field] = value || '';
    }
  });

  return normalized;
}

function decryptStoredSettings(storedSettings = {}) {
  const resolved = {};

  SETTINGS_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(storedSettings, field)) {
      return;
    }

    if (SENSITIVE_FIELDS.has(field)) {
      resolved[field] = storedSettings[field] ? decryptValue(storedSettings[field]) : null;
      return;
    }

    resolved[field] = firstText(storedSettings[field]);
  });

  return resolved;
}

function getStoreSettings(shopDomain) {
  const normalizedShop = validateShopDomainOrThrow(shopDomain);
  const store = readStore();
  const shopEntry = store.shops[normalizedShop];

  if (!shopEntry || !shopEntry.settings) {
    return null;
  }

  return {
    shopDomain: normalizedShop,
    updatedAt: shopEntry.updatedAt || null,
    settings: decryptStoredSettings(shopEntry.settings),
  };
}

function saveStoreSettings(shopDomain, payload = {}) {
  const normalizedShop = validateShopDomainOrThrow(shopDomain);
  const normalizedSettings = normalizeIncomingSettings(payload);
  const store = readStore();
  const previousEntry = store.shops[normalizedShop];
  const previousSettings = previousEntry?.settings || {};
  const nextSettings = {};

  SETTINGS_FIELDS.forEach((field) => {
    const incomingValue = normalizedSettings[field];

    if (SENSITIVE_FIELDS.has(field)) {
      if (incomingValue) {
        nextSettings[field] = encryptValue(incomingValue);
      } else if (previousSettings[field]) {
        nextSettings[field] = previousSettings[field];
      }

      return;
    }

    if (incomingValue) {
      nextSettings[field] = incomingValue;
      return;
    }

    if (previousSettings[field]) {
      nextSettings[field] = previousSettings[field];
    }
  });

  store.shops[normalizedShop] = {
    updatedAt: new Date().toISOString(),
    settings: nextSettings,
  };

  writeStore(store);

  return getStoreSettings(normalizedShop);
}

function buildRuntimeSettings(shopDomain) {
  const requestedShop = normalizeShopDomain(shopDomain);
  const normalizedShop = isValidShopDomain(requestedShop) ? requestedShop : null;
  const runtimeShopDomain = requestedShop || null;
  const saved = normalizedShop ? getStoreSettings(normalizedShop) : null;
  const settings = saved?.settings || {};

  return {
    shopDomain:
      normalizedShop ||
      runtimeShopDomain ||
      firstText(process.env.SHOPIFY_STORE_DOMAIN) ||
      null,
    shiprocketEmail: settings.shiprocketEmail || firstText(process.env.SHIPROCKET_EMAIL),
    shiprocketPassword: settings.shiprocketPassword || firstText(process.env.SHIPROCKET_PASSWORD),
    storefrontAccessToken:
      settings.storefrontAccessToken || firstText(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN),
    storeName:
      settings.storeName ||
      firstText(process.env.STORE_NAME) ||
      firstText(process.env.SHOPIFY_APP_NAME),
    supportEmail: settings.supportEmail || firstText(process.env.STORE_SUPPORT_EMAIL),
    supportPhone: settings.supportPhone || firstText(process.env.STORE_SUPPORT_PHONE),
    supportWhatsapp: settings.supportWhatsapp || firstText(process.env.STORE_SUPPORT_WHATSAPP),
    supportHours: settings.supportHours || firstText(process.env.STORE_SUPPORT_HOURS),
    shippingPolicy: settings.shippingPolicy || firstText(process.env.STORE_SHIPPING_POLICY),
    returnPolicy: settings.returnPolicy || firstText(process.env.STORE_RETURN_POLICY),
    codPolicy: settings.codPolicy || firstText(process.env.STORE_COD_POLICY),
    cancellationPolicy:
      settings.cancellationPolicy || firstText(process.env.STORE_CANCELLATION_POLICY),
    orderProcessingTime:
      settings.orderProcessingTime || firstText(process.env.STORE_ORDER_PROCESSING_TIME),
    contactUrl: settings.contactUrl || firstText(process.env.STORE_CONTACT_URL),
    aboutText: settings.aboutText || firstText(process.env.STORE_ABOUT_TEXT),
    updatedAt: saved?.updatedAt || null,
    hasSavedSettings: Boolean(saved),
  };
}

function getAdminSettingsView(shopDomain) {
  const saved = getStoreSettings(shopDomain);

  return {
    shopDomain: saved?.shopDomain || validateShopDomainOrThrow(shopDomain),
    updatedAt: saved?.updatedAt || null,
    settings: {
      shiprocketEmail: saved?.settings?.shiprocketEmail || '',
      hasShiprocketPassword: Boolean(saved?.settings?.shiprocketPassword),
      hasStorefrontAccessToken: Boolean(saved?.settings?.storefrontAccessToken),
      storeName: saved?.settings?.storeName || '',
      supportEmail: saved?.settings?.supportEmail || '',
      supportPhone: saved?.settings?.supportPhone || '',
      supportWhatsapp: saved?.settings?.supportWhatsapp || '',
      supportHours: saved?.settings?.supportHours || '',
      shippingPolicy: saved?.settings?.shippingPolicy || '',
      returnPolicy: saved?.settings?.returnPolicy || '',
      codPolicy: saved?.settings?.codPolicy || '',
      cancellationPolicy: saved?.settings?.cancellationPolicy || '',
      orderProcessingTime: saved?.settings?.orderProcessingTime || '',
      contactUrl: saved?.settings?.contactUrl || '',
      aboutText: saved?.settings?.aboutText || '',
    },
  };
}

module.exports = {
  buildRuntimeSettings,
  getAdminSettingsView,
  getStoreSettings,
  getStoreSettingsFilePath,
  saveStoreSettings,
  validateShopDomainOrThrow,
};
