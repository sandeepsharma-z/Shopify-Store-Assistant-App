const { HttpError } = require('../utils/httpError');

function getMessageValue(value) {
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

function getHistoryValue(payload) {
  if (!Array.isArray(payload.history)) {
    return [];
  }

  return payload.history
    .filter(function isValidTurn(entry) {
      return (
        entry &&
        typeof entry === 'object' &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.text === 'string' &&
        entry.text.trim()
      );
    })
    .map(function normalizeTurn(entry) {
      return {
        role: entry.role,
        text: String(entry.text).trim().slice(0, 400),
      };
    })
    .slice(-12);
}

function createChatRequestValidator({ source = 'body' } = {}) {
  return (req, res, next) => {
    const payload = source === 'query' ? req.query : req.body || {};
    const message = getMessageValue(payload.message);
    const fallbackShopDomain =
      source === 'query' ? '' : getShopDomainValue(req.query || {});

    if (!message) {
      next(new HttpError(400, 'Send a message for the chatbot to answer.', 'INVALID_CHAT_INPUT'));
      return;
    }

    if (message.length > 500) {
      next(
        new HttpError(
          400,
          'Message is too long. Keep it under 500 characters.',
          'INVALID_CHAT_INPUT',
        ),
      );
      return;
    }

    req.chatRequest = {
      message,
      shopDomain: getShopDomainValue(payload) || fallbackShopDomain,
      history: getHistoryValue(payload),
    };

    next();
  };
}

module.exports = {
  createChatRequestValidator,
};
