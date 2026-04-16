const express = require('express');

const { chatWithAssistant } = require('../controllers/chatController');
const { trackOrder } = require('../controllers/trackingController');
const { createChatRequestValidator } = require('../middleware/validateChatRequest');
const { createTrackRequestValidator } = require('../middleware/validateTrackRequest');
const verifyShopifyProxy = require('../middleware/verifyShopifyProxy');

const router = express.Router();

router.post('/api/chatbot', createChatRequestValidator({ source: 'body' }), chatWithAssistant);
router.get(
  '/apps/track-order/chat',
  verifyShopifyProxy,
  createChatRequestValidator({ source: 'query' }),
  chatWithAssistant,
);
router.post(
  '/apps/track-order/chat',
  verifyShopifyProxy,
  createChatRequestValidator({ source: 'body' }),
  chatWithAssistant,
);
router.post('/api/track-order', createTrackRequestValidator({ source: 'body' }), trackOrder);
router.get(
  '/apps/track-order',
  verifyShopifyProxy,
  createTrackRequestValidator({ source: 'query' }),
  trackOrder,
);
router.post(
  '/apps/track-order',
  verifyShopifyProxy,
  createTrackRequestValidator({ source: 'body' }),
  trackOrder,
);

module.exports = router;
