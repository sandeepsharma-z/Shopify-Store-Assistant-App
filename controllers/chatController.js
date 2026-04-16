const { createChatReply } = require('../services/chatAssistant');

async function chatWithAssistant(req, res, next) {
  try {
    const response = await createChatReply(req.chatRequest);

    res.status(response.success === false ? 400 : 200).json(response);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  chatWithAssistant,
};
