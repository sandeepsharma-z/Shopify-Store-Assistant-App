const express = require('express');

const trackingRoutes = require('./trackingRoutes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

router.use(trackingRoutes);

module.exports = router;
