const logger = require('../utils/logger');

const FALLBACK_MESSAGE =
  "We couldn't fetch live tracking details right now. Please try again in a few minutes or contact support.";

function errorHandler(error, req, res, next) {
  const isCorsError = error.message === 'Not allowed by CORS';
  const statusCode = isCorsError ? 403 : Number(error.statusCode || error.status || 500);
  const code = isCorsError ? 'CORS_NOT_ALLOWED' : error.code || 'INTERNAL_ERROR';
  const isSettingsError =
    code.startsWith('SETTINGS_') ||
    code.startsWith('STORE_SETTINGS_') ||
    code === 'INVALID_SHOP_DOMAIN';
  const reply =
    statusCode >= 500 && !isSettingsError
      ? FALLBACK_MESSAGE
      : isCorsError
        ? 'This origin is not allowed to call the tracking API.'
        : error.message || FALLBACK_MESSAGE;

  logger.error(reply, {
    code,
    statusCode,
    method: req.method,
    path: req.originalUrl,
    details: error.details || null,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    reply,
    ...(process.env.NODE_ENV !== 'production' ? { code } : {}),
  });
}

module.exports = errorHandler;
