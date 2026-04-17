const { HttpError } = require('../utils/httpError');

const AWB_PATTERN = /^[A-Za-z0-9-]{6,40}$/;
const ORDER_ID_PATTERN = /^[A-Za-z0-9#/_-]{1,100}$/;

function getNormalizedValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getShopDomainValue(payload) {
  const candidates = [payload.shopDomain, payload.shop_domain, payload.shop];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function createTrackRequestValidator({ source = 'body' } = {}) {
  return (req, res, next) => {
    const payload = source === 'query' ? req.query : req.body || {};
    const awb = getNormalizedValue(payload.awb);
    const orderId = getNormalizedValue(payload.order_id || payload.orderId);
    const fallbackShopDomain =
      source === 'query' ? '' : getShopDomainValue(req.query || {});

    if ((awb && orderId) || (!awb && !orderId)) {
      next(
        new HttpError(
          400,
          'Send either an AWB number or an order_id.',
          'INVALID_LOOKUP_INPUT',
        ),
      );
      return;
    }

    if (awb && !AWB_PATTERN.test(awb)) {
      next(new HttpError(400, 'Invalid AWB number. Please check and try again.', 'INVALID_AWB'));
      return;
    }

    if (orderId && !ORDER_ID_PATTERN.test(orderId)) {
      next(
        new HttpError(400, 'Invalid order ID. Please check and try again.', 'INVALID_ORDER_ID'),
      );
      return;
    }

    req.trackingLookup = {
      awb: awb || null,
      orderId: orderId || null,
      shopDomain: getShopDomainValue(payload) || fallbackShopDomain,
    };

    next();
  };
}

module.exports = {
  createTrackRequestValidator,
};
