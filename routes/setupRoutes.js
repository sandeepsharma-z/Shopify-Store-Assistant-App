const express = require('express');

const {
  getSetupStatus,
  serveAuthCallbackInfo,
  serveShopifyAppHome,
} = require('../controllers/setupController');

const router = express.Router();

router.get('/api/setup-status', getSetupStatus);
router.get('/shopify/app-home', serveShopifyAppHome);
router.get('/auth/callback', serveAuthCallbackInfo);
router.get('/auth/oauth/callback', serveAuthCallbackInfo);

module.exports = router;
