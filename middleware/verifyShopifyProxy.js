const crypto = require('crypto');

const { HttpError } = require('../utils/httpError');
const logger = require('../utils/logger');

let warnedAboutMissingSecret = false;

function getSignaturePayload(query) {
  return Object.keys(query)
    .filter((key) => key !== 'signature')
    .sort()
    .map((key) => {
      const value = Array.isArray(query[key]) ? query[key].join(',') : query[key];
      return `${key}=${value}`;
    })
    .join('');
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyShopifyProxy(req, res, next) {
  const shopifySecret = (process.env.SHOPIFY_API_SECRET || '').trim();

  if (!shopifySecret) {
    if (process.env.NODE_ENV === 'production') {
      next(
        new HttpError(
          500,
          'Shopify app proxy is not configured on the server.',
          'SHOPIFY_PROXY_NOT_CONFIGURED',
        ),
      );
      return;
    }

    if (!warnedAboutMissingSecret) {
      logger.warn(
        'SHOPIFY_API_SECRET is missing. Skipping app proxy signature validation outside production.',
      );
      warnedAboutMissingSecret = true;
    }

    next();
    return;
  }

  const providedSignature = typeof req.query.signature === 'string' ? req.query.signature : '';

  if (!providedSignature) {
    next(
      new HttpError(
        403,
        'Shopify app proxy signature is missing.',
        'INVALID_SHOPIFY_PROXY_SIGNATURE',
      ),
    );
    return;
  }

  const computedSignature = crypto
    .createHmac('sha256', shopifySecret)
    .update(getSignaturePayload(req.query))
    .digest('hex');

  if (!safeCompare(providedSignature, computedSignature)) {
    next(
      new HttpError(
        403,
        'Shopify app proxy signature is invalid.',
        'INVALID_SHOPIFY_PROXY_SIGNATURE',
      ),
    );
    return;
  }

  next();
}

module.exports = verifyShopifyProxy;
