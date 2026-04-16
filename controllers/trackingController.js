const { fetchTracking } = require('../services/shiprocket');

async function trackOrder(req, res, next) {
  try {
    const trackingResponse = await fetchTracking(req.trackingLookup);

    res.status(200).json(trackingResponse);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  trackOrder,
};
