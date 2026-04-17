require('dotenv').config({ quiet: true });

const path = require('path');

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const routes = require('./routes');
const logger = require('./utils/logger');

const app = express();

const allowedOrigins = (process.env.ALLOW_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
    frameguard: false,
  }),
);

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    'frame-ancestors https://admin.shopify.com https://*.myshopify.com;'
  );
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
  }),
);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: logger.stream }));
app.use(
  '/preview-assets',
  express.static(path.join(__dirname, 'extensions', 'order-tracker-widget', 'assets')),
);
app.use('/public-assets', express.static(path.join(__dirname, 'public')));

function getServiceInfo() {
  return {
    success: true,
    service: 'shopify-shiprocket-order-tracker',
    health: '/health',
    setup_status: '/api/setup-status',
    app_home: '/shopify/app-home',
    store_settings: '/api/store-settings',
    chatbot: '/api/chatbot',
    track_order: '/api/track-order',
    shopify_proxy: '/apps/track-order',
    preview: '/preview',
  };
}

function isShopifyAdminRequest(req) {
  return Boolean(req.query?.shop || req.query?.host || req.query?.embedded);
}

app.get('/', (req, res) => {
  if (isShopifyAdminRequest(req)) {
    const searchParams = new URLSearchParams();

    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          searchParams.append(key, item);
        });
        return;
      }

      if (typeof value === 'string') {
        searchParams.set(key, value);
      }
    });

    const search = searchParams.toString();
    res.redirect(`/shopify/app-home${search ? `?${search}` : ''}`);
    return;
  }

  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'public', 'preview.html'));
    return;
  }

  res.json(getServiceInfo());
});

app.get('/preview', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'preview.html'));
});

app.get('/service-info', (req, res) => {
  res.json(getServiceInfo());
});

app.use(routes);
app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 3000);

if (require.main === module) {
  app.listen(port, () => {
    logger.info('Server started', {
      port,
      environment: process.env.NODE_ENV || 'development',
    });
  });
}

module.exports = app;
