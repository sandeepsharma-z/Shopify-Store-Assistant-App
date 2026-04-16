const { HttpError } = require('../utils/httpError');

function notFound(req, res, next) {
  next(new HttpError(404, 'Route not found.', 'ROUTE_NOT_FOUND'));
}

module.exports = notFound;
