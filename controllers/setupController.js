function getBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.get('host') || '')
    .split(',')[0]
    .trim();

  return `${forwardedProto || 'https'}://${forwardedHost}`;
}

function buildSetupStatus(req) {
  const baseUrl = getBaseUrl(req);
  const appName = (process.env.SHOPIFY_APP_NAME || 'Shopify Store Assistant App').trim();
  const appHandle = (process.env.SHOPIFY_APP_HANDLE || 'shopify-store-assistant-app').trim();
  const storeDomain = String(process.env.SHOPIFY_STORE_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const applicationUrl = `${baseUrl}/shopify/app-home`;
  const redirectUrls = [`${baseUrl}/auth/callback`, `${baseUrl}/auth/oauth/callback`];
  const proxyBaseUrl = `${baseUrl}/apps/track-order`;
  const storefrontScopes = [
    'unauthenticated_read_product_listings',
    'unauthenticated_read_product_inventory',
  ];
  const envConfigured = {
    shiprocket_email: Boolean((process.env.SHIPROCKET_EMAIL || '').trim()),
    shiprocket_password: Boolean((process.env.SHIPROCKET_PASSWORD || '').trim()),
    shopify_api_secret: Boolean((process.env.SHOPIFY_API_SECRET || '').trim()),
    shopify_store_domain: Boolean((process.env.SHOPIFY_STORE_DOMAIN || '').trim()),
    shopify_storefront_access_token: Boolean(
      (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || '').trim(),
    ),
  };
  const missingEnv = Object.keys(envConfigured).filter((key) => !envConfigured[key]);

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
      shop_domain: storeDomain || null,
      graphql_url: storeDomain
        ? `https://${storeDomain}/api/${
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
    notes: {
      shiprocket_credentials:
        'Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD only on your backend host. Do not paste Shiprocket credentials into Shopify app dashboard fields.',
    },
    env: {
      configured: envConfigured,
      missing: missingEnv,
    },
  };
}

function renderBadge(value) {
  return value
    ? '<span style="color:#0f8a4b;font-weight:700;">Configured</span>'
    : '<span style="color:#c5492f;font-weight:700;">Missing</span>';
}

function serveShopifyAppHome(req, res) {
  const status = buildSetupStatus(req);
  const envRows = Object.entries(status.env.configured)
    .map(
      ([key, value]) =>
        `<tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">${key}</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">${renderBadge(value)}</td></tr>`,
    )
    .join('');
  const storefrontScopes = status.scopes.storefront.join(', ');
  const authenticatedScopes = status.scopes.authenticated.join(', ');
  const missingEnv = status.env.missing.length
    ? status.env.missing.join(', ')
    : 'None';

  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${status.app.name}</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: linear-gradient(180deg, #fffaf6 0%, #f2ece6 100%);
        color: #1f2630;
      }
      .shell {
        width: min(980px, calc(100% - 32px));
        margin: 32px auto;
      }
      .card {
        background: rgba(255,255,255,0.92);
        border: 1px solid rgba(31,38,48,0.08);
        border-radius: 24px;
        box-shadow: 0 20px 44px rgba(21,31,43,0.08);
        padding: 28px;
      }
      h1, h2 {
        margin: 0 0 12px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.65;
        color: #596676;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-top: 18px;
      }
      .value {
        padding: 14px 16px;
        border-radius: 18px;
        background: #fff8f2;
        border: 1px solid rgba(236,132,90,0.14);
      }
      .value strong {
        display: block;
        margin-bottom: 6px;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      code, pre {
        font-family: Consolas, "Courier New", monospace;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
        background: #fff;
        border-radius: 18px;
        overflow: hidden;
      }
      .section {
        margin-top: 22px;
      }
      @media (max-width: 720px) {
        .grid {
          grid-template-columns: 1fr;
        }
        .card {
          padding: 20px;
          border-radius: 20px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="card">
        <h1>${status.app.name}</h1>
        <p>Use these values in Shopify app setup so the Shiprocket + storefront assistant works live.</p>

        <div class="grid">
          <div class="value">
            <strong>Shopify App URL</strong>
            <pre>${status.dashboard.app_url}</pre>
          </div>
          <div class="value">
            <strong>Allowed Redirect URLs</strong>
            <pre>${status.dashboard.allowed_redirection_urls.join('\n')}</pre>
          </div>
          <div class="value">
            <strong>App Proxy</strong>
            <pre>Prefix: ${status.app_proxy.prefix}
Subpath: ${status.app_proxy.subpath}
Proxy URL: ${status.app_proxy.proxy_url}
Chat Proxy URL: ${status.app_proxy.chat_proxy_url}</pre>
          </div>
          <div class="value">
            <strong>Storefront API</strong>
            <pre>Shop Domain: ${status.storefront_api.shop_domain || 'Not set'}
GraphQL URL: ${status.storefront_api.graphql_url || 'Not available until SHOPIFY_STORE_DOMAIN is set'}
Required scopes: ${storefrontScopes}</pre>
          </div>
        </div>

        <div class="section">
          <h2>What To Fill In Shopify</h2>
          <table>
            <tbody>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">App URL</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${status.dashboard.app_url}</code></td></tr>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">Allowed redirection URL 1</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${status.dashboard.allowed_redirection_urls[0]}</code></td></tr>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">Allowed redirection URL 2</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${status.dashboard.allowed_redirection_urls[1]}</code></td></tr>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">App proxy prefix</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${status.app_proxy.prefix}</code></td></tr>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">App proxy subpath</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${status.app_proxy.subpath}</code></td></tr>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">App proxy URL</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${status.app_proxy.proxy_url}</code></td></tr>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">Authenticated API scopes</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${authenticatedScopes}</code></td></tr>
              <tr><td style="padding:10px 12px;border-bottom:1px solid #ece7df;">Storefront API scopes</td><td style="padding:10px 12px;border-bottom:1px solid #ece7df;"><code>${storefrontScopes}</code></td></tr>
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Environment Status</h2>
          <p>Missing variables: <code>${missingEnv}</code></p>
          <table>
            <tbody>
              ${envRows}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Theme Extension</h2>
          <p>Deploy the extension from <code>${status.theme_extension.directory}</code>, then enable the app embed named <strong>${status.theme_extension.block_name}</strong> in the theme customizer.</p>
        </div>

        <div class="section">
          <h2>Storefront Token Setup</h2>
          <p>Create a Storefront access token in Shopify, then enable <code>${storefrontScopes}</code>. This lets the chatbot answer product, collection, price, and availability questions.</p>
        </div>

        <div class="section">
          <h2>Shiprocket Setup</h2>
          <p>${status.notes.shiprocket_credentials}</p>
        </div>

        <div class="section">
          <h2>API JSON</h2>
          <p>Machine-readable setup values are available at <code>/api/setup-status</code>.</p>
        </div>
      </section>
    </main>
  </body>
</html>`);
}

function getSetupStatus(req, res) {
  res.json(buildSetupStatus(req));
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
  getSetupStatus,
  serveAuthCallbackInfo,
  serveShopifyAppHome,
};
