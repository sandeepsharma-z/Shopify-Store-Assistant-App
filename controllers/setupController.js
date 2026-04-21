const {
  buildRuntimeSettings,
  getStoreSettings,
  getStoreSettingsFilePath,
} = require('../services/storeSettings');
const {
  createSettingsAccessToken,
  getSettingsTokenSecret,
  isValidShopDomain,
  normalizeShopDomain,
  verifyShopifyQueryHmac,
} = require('../utils/shopify');

function getBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.get('host') || '')
    .split(',')[0]
    .trim();

  return `${forwardedProto || 'https'}://${forwardedHost}`;
}

function resolveShopContext(req) {
  const requestedShop = normalizeShopDomain(req.query.shop || process.env.SHOPIFY_STORE_DOMAIN || '');
  const secret = getSettingsTokenSecret();
  const hasShop = isValidShopDomain(requestedShop);
  const hasHmac = typeof req.query.hmac === 'string' && req.query.hmac.trim();
  const hmacValid = hasHmac && secret ? verifyShopifyQueryHmac(req.query, secret) : false;
  const localEditable = process.env.NODE_ENV !== 'production';
  const embeddedAdminContext =
    hasShop &&
    typeof req.query.host === 'string' &&
    req.query.host.trim() &&
    (String(req.query.embedded || '') === '1' ||
      String(req.get('referer') || '').includes('admin.shopify.com'));
  const canEdit = hasShop && (hmacValid || embeddedAdminContext || localEditable);

  return {
    shopDomain: hasShop ? requestedShop : null,
    hmacValid,
    embeddedAdminContext,
    canEdit,
    settingsToken: canEdit ? createSettingsAccessToken({ shopDomain: requestedShop, ttlMs: 4 * 60 * 60 * 1000 }) : null,
  };
}

function buildSetupStatus(req) {
  const baseUrl = getBaseUrl(req);
  const appName = (process.env.SHOPIFY_APP_NAME || 'Shopify Store Assistant App').trim();
  const appHandle = (process.env.SHOPIFY_APP_HANDLE || 'shopify-store-assistant-app').trim();
  const applicationUrl = `${baseUrl}/shopify/app-home`;
  const redirectUrls = [`${baseUrl}/auth/callback`, `${baseUrl}/auth/oauth/callback`];
  const proxyBaseUrl = `${baseUrl}/apps/track-order`;
  const storefrontScopes = [
    'unauthenticated_read_product_listings',
    'unauthenticated_read_product_inventory',
  ];
  const shopContext = resolveShopContext(req);
  const savedSettings = shopContext.shopDomain ? getStoreSettings(shopContext.shopDomain) : null;
  const runtime = shopContext.shopDomain ? buildRuntimeSettings(shopContext.shopDomain) : null;
  const envConfigured = {
    shopify_api_secret: Boolean((process.env.SHOPIFY_API_SECRET || '').trim()),
    settings_encryption_key: Boolean(
      (process.env.SETTINGS_ENCRYPTION_KEY || process.env.SHOPIFY_API_SECRET || '').trim(),
    ),
    fallback_shiprocket_email: Boolean((process.env.SHIPROCKET_EMAIL || '').trim()),
    fallback_shiprocket_password: Boolean((process.env.SHIPROCKET_PASSWORD || '').trim()),
    fallback_shopify_store_domain: Boolean((process.env.SHOPIFY_STORE_DOMAIN || '').trim()),
    fallback_storefront_access_token: Boolean(
      (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || '').trim(),
    ),
  };
  const optionalSupportEnv = {
    store_name: Boolean((process.env.STORE_NAME || '').trim()),
    store_support_email: Boolean((process.env.STORE_SUPPORT_EMAIL || '').trim()),
    store_support_phone: Boolean((process.env.STORE_SUPPORT_PHONE || '').trim()),
    store_support_whatsapp: Boolean((process.env.STORE_SUPPORT_WHATSAPP || '').trim()),
    store_support_hours: Boolean((process.env.STORE_SUPPORT_HOURS || '').trim()),
    store_shipping_policy: Boolean((process.env.STORE_SHIPPING_POLICY || '').trim()),
    store_return_policy: Boolean((process.env.STORE_RETURN_POLICY || '').trim()),
    store_cod_policy: Boolean((process.env.STORE_COD_POLICY || '').trim()),
    store_cancellation_policy: Boolean((process.env.STORE_CANCELLATION_POLICY || '').trim()),
    store_order_processing_time: Boolean((process.env.STORE_ORDER_PROCESSING_TIME || '').trim()),
    store_contact_url: Boolean((process.env.STORE_CONTACT_URL || '').trim()),
    store_about_text: Boolean((process.env.STORE_ABOUT_TEXT || '').trim()),
  };

  return {
    success: true,
    app: {
      name: appName,
      handle: appHandle,
      embedded: false,
      application_url: applicationUrl,
      redirect_urls: redirectUrls,
    },
    dashboard: {
      app_url: applicationUrl,
      allowed_redirection_urls: redirectUrls,
    },
    app_proxy: {
      prefix: 'apps',
      subpath: 'track-order',
      proxy_url: proxyBaseUrl,
      chat_proxy_url: `${proxyBaseUrl}/chat`,
      storefront_paths: ['/apps/track-order', '/apps/track-order/chat'],
    },
    storefront_api: {
      shop_domain: runtime?.shopDomain || null,
      graphql_url: runtime?.shopDomain
        ? `https://${runtime.shopDomain}/api/${
            process.env.SHOPIFY_STOREFRONT_API_VERSION || '2025-07'
          }/graphql.json`
        : null,
      required_access_scopes: storefrontScopes,
    },
    theme_extension: {
      directory: 'extensions/order-tracker-widget',
      block_name: 'Order Assistant Chatbot',
      embed_target: 'body',
    },
    scopes: {
      authenticated: ['write_app_proxy'],
      storefront: storefrontScopes,
    },
    current_shop: {
      shop_domain: shopContext.shopDomain,
      can_edit_settings: shopContext.canEdit,
      hmac_valid: shopContext.hmacValid,
      has_saved_settings: Boolean(savedSettings),
      updated_at: savedSettings?.updatedAt || null,
    },
    storage: {
      file_path: getStoreSettingsFilePath(),
    },
    notes: {
      merchant_settings:
        'Open this app from Shopify admin to save the per-store Gemini API key.',
      shiprocket_credentials:
        'Shiprocket and storefront values are currently expected from server-side environment configuration.',
    },
    env: {
      configured: envConfigured,
      optional_support: optionalSupportEnv,
    },
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serveShopifyAppHome(req, res, next) {
  try {
    const status = buildSetupStatus(req);
    const shopContext = resolveShopContext(req);
    const pageConfig = {
      baseUrl: getBaseUrl(req),
      shopDomain: shopContext.shopDomain,
      canEdit: shopContext.canEdit,
      hmacValid: shopContext.hmacValid,
      embeddedAdminContext: shopContext.embeddedAdminContext,
      settingsToken: shopContext.settingsToken,
      endpoints: {
        settings: '/api/store-settings',
        setupStatus: '/api/setup-status',
      },
      status,
    };
    const serializedConfig = JSON.stringify(pageConfig).replace(/</g, '\\u003c');

    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(status.app.name)}</title>
    <link rel="stylesheet" href="/public-assets/app-home.css" />
  </head>
  <body>
    <main class="app-home-shell">
      <section class="app-home-hero">
        <div>
          <span class="app-home-kicker">Shopify app settings</span>
          <h1>${escapeHtml(status.app.name)}</h1>
          <p>Save the Gemini API key here. Shiprocket, storefront, and other store values stay on the server configuration.</p>
        </div>
        <div class="app-home-hero-card">
          <strong>Detected shop</strong>
          <span>${escapeHtml(status.current_shop.shop_domain || 'Not detected')}</span>
          <small>${status.current_shop.can_edit_settings ? 'Settings form is editable.' : 'Open this page from Shopify admin for editable access.'}</small>
        </div>
      </section>

      <section class="app-home-grid">
        <section class="app-home-panel">
          <div class="app-home-panel-head">
            <h2>Merchant Settings</h2>
            <p>These settings are editable only from inside Shopify admin.</p>
          </div>
          <div id="app-home-alert" class="app-home-alert" hidden></div>
          ${
            status.current_shop.can_edit_settings
              ? `<form id="app-home-settings-form" class="app-home-form">
            <input id="shopDomain" name="shopDomain" type="hidden" value="${escapeHtml(
              status.current_shop.shop_domain || '',
            )}" />
            <div class="app-home-form-grid is-single">
              <label>
                <span>Gemini API key</span>
                <input id="geminiApiKey" name="geminiApiKey" type="password" placeholder="Paste Gemini API key" />
                <small id="geminiApiKeyHint"></small>
              </label>
            </div>

            <div class="app-home-actions">
              <button id="app-home-save-button" type="submit">Save settings</button>
              <span id="app-home-meta" class="app-home-meta"></span>
            </div>
          </form>`
              : `<div class="app-home-readonly">
            <p>Open this app from Shopify admin to edit store settings.</p>
            <p>The Gemini API key is intentionally hidden on direct live links and can only be saved from the embedded admin app.</p>
          </div>`
          }
        </section>

        <section class="app-home-stack">
          <section class="app-home-panel">
            <div class="app-home-panel-head">
              <h2>Shopify Values</h2>
              <p>Paste these in the Shopify app dashboard.</p>
            </div>
            <dl class="app-home-list">
              <div><dt>App URL</dt><dd><code>${escapeHtml(status.dashboard.app_url)}</code></dd></div>
              <div><dt>Redirect URL</dt><dd><code>${escapeHtml(status.dashboard.allowed_redirection_urls[0])}</code></dd></div>
              <div><dt>Redirect URL</dt><dd><code>${escapeHtml(status.dashboard.allowed_redirection_urls[1])}</code></dd></div>
              <div><dt>App proxy</dt><dd><code>${escapeHtml(status.app_proxy.proxy_url)}</code></dd></div>
              <div><dt>Proxy prefix/subpath</dt><dd><code>${escapeHtml(status.app_proxy.prefix)} / ${escapeHtml(status.app_proxy.subpath)}</code></dd></div>
              <div><dt>Storefront scopes</dt><dd><code>${escapeHtml(status.scopes.storefront.join(', '))}</code></dd></div>
            </dl>
          </section>

          <section class="app-home-panel">
            <div class="app-home-panel-head">
              <h2>Runtime Status</h2>
              <p>Current store and persistence details.</p>
            </div>
            <dl class="app-home-list">
              <div><dt>Detected shop</dt><dd>${escapeHtml(status.current_shop.shop_domain || 'Not detected')}</dd></div>
              <div><dt>Editable access</dt><dd>${status.current_shop.can_edit_settings ? 'Yes' : 'No'}</dd></div>
              <div><dt>Embedded admin context</dt><dd>${shopContext.embeddedAdminContext ? 'Yes' : 'No'}</dd></div>
              <div><dt>Saved settings</dt><dd>${status.current_shop.has_saved_settings ? 'Yes' : 'No'}</dd></div>
              <div><dt>Last updated</dt><dd>${escapeHtml(status.current_shop.updated_at || 'Not saved yet')}</dd></div>
              <div><dt>Settings file</dt><dd><code>${escapeHtml(status.storage.file_path)}</code></dd></div>
            </dl>
          </section>
        </section>
      </section>
    </main>

    <script>window.__SHOPIFY_APP_HOME__ = ${serializedConfig};</script>
    <script src="/public-assets/app-home.js" defer></script>
  </body>
</html>`);
  } catch (error) {
    next(error);
  }
}

function getSetupStatus(req, res, next) {
  try {
    res.json(buildSetupStatus(req));
  } catch (error) {
    next(error);
  }
}

function serveAuthCallbackInfo(req, res) {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Shopify Callback</title>
    <style>
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        display: grid;
        place-items: center;
        min-height: 100vh;
        background: #f7f1eb;
        color: #1f2630;
      }
      .card {
        width: min(560px, calc(100% - 32px));
        background: #fff;
        padding: 28px;
        border-radius: 24px;
        border: 1px solid rgba(31,38,48,0.08);
        box-shadow: 0 18px 42px rgba(21,31,43,0.08);
      }
      h1 { margin-top: 0; }
      p { line-height: 1.6; color: #5d6977; }
    </style>
  </head>
  <body>
    <section class="card">
      <h1>Shopify callback endpoint is reachable.</h1>
      <p>This backend is intended for app proxy, theme app extension, Shiprocket tracking, and storefront assistant responses.</p>
      <p>If you are configuring the Shopify app dashboard, go back and continue setup from <code>/shopify/app-home</code>.</p>
    </section>
  </body>
</html>`);
}

module.exports = {
  buildSetupStatus,
  getSetupStatus,
  serveAuthCallbackInfo,
  serveShopifyAppHome,
};
