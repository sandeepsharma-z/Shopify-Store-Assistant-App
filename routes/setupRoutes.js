const express = require('express');

const {
  getStoreSettingsForAdmin,
  saveStoreSettingsFromAdmin,
} = require('../controllers/settingsController');
const {
  getSetupStatus,
  serveAuthCallbackInfo,
  serveShopifyAppHome,
} = require('../controllers/setupController');
const requireSettingsAccess = require('../middleware/requireSettingsAccess');

const router = express.Router();

router.get('/api/setup-status', getSetupStatus);
router.get('/api/store-settings', requireSettingsAccess, getStoreSettingsForAdmin);
router.post('/api/store-settings', requireSettingsAccess, saveStoreSettingsFromAdmin);
router.get('/shopify/app-home', serveShopifyAppHome);
router.get('/auth/callback', serveAuthCallbackInfo);
router.get('/auth/oauth/callback', serveAuthCallbackInfo);

module.exports = router;
