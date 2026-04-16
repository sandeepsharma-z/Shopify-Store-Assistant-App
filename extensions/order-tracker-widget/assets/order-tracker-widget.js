(function bootstrapOrderAssistant() {
  const rootSelector = '.shiprocket-order-tracker-root';
  const sessionKeyPrefix = 'shiprocket-order-assistant:v5:';
  const maxStoredMessages = 30;
  const defaultSuggestions = [
    'Track my order',
    'Find products',
    'Browse collections',
    'Check availability',
  ];
  const starterPrompts = [
    'Track my order',
    'Find products',
    'Browse collections',
    'Check availability',
  ];

  function parseJsonSafe(response) {
    return response.text().then(function toJson(text) {
      if (!text) {
        return {};
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        return {};
      }
    });
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (typeof text === 'string') {
      element.textContent = text;
    }

    return element;
  }

  function createButton(className, text, type) {
    const button = createElement('button', className, text);
    button.type = type || 'button';
    return button;
  }

  function wait(ms) {
    return new Promise(function resolveAfterDelay(resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function readSessionState(storageKey) {
    try {
      const rawValue = window.sessionStorage.getItem(storageKey);

      if (!rawValue) {
        return {
          messages: [],
          suggestions: defaultSuggestions.slice(),
        };
      }

      const parsed = JSON.parse(rawValue);
      const messages = Array.isArray(parsed.messages)
        ? parsed.messages
            .filter(function isValid(entry) {
              if (!entry || typeof entry !== 'object' || !entry.payload || typeof entry.payload !== 'object') {
                return false;
              }

              if (entry.role === 'assistant') {
                return typeof entry.payload.reply === 'string' && entry.payload.reply.trim();
              }

              if (entry.role === 'user') {
                return typeof entry.payload.text === 'string' && entry.payload.text.trim();
              }

              return false;
            })
            .slice(-maxStoredMessages)
        : [];
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter(Boolean).slice(0, 4)
        : defaultSuggestions.slice();

      return {
        messages: messages,
        suggestions: suggestions.length ? suggestions : defaultSuggestions.slice(),
      };
    } catch (error) {
      return {
        messages: [],
        suggestions: defaultSuggestions.slice(),
      };
    }
  }

  function writeSessionState(storageKey, state) {
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          messages: state.messages.slice(-maxStoredMessages),
          suggestions: state.suggestions.slice(0, 4),
        }),
      );
    } catch (error) {
      return;
    }
  }

  function scrollToBottom(container) {
    window.requestAnimationFrame(function onFrame() {
      container.scrollTop = container.scrollHeight;
    });
  }

  function createTypingNode() {
    const message = createElement(
      'div',
      'shiprocket-chat-message shiprocket-chat-message--assistant',
    );
    const bubble = createElement(
      'div',
      'shiprocket-chat-bubble shiprocket-chat-bubble--assistant shiprocket-chat-bubble--typing',
    );
    const dots = createElement('div', 'shiprocket-chat-typing');

    for (let index = 0; index < 3; index += 1) {
      dots.appendChild(createElement('span', 'shiprocket-chat-typing-dot'));
    }

    bubble.appendChild(dots);
    message.appendChild(bubble);

    return message;
  }

  function renderTrackingCard(payload) {
    if (!payload || !payload.tracking) {
      return null;
    }

    const tracking = payload.tracking;
    const card = createElement('div', 'shiprocket-chat-tracking-card');
    const top = createElement('div', 'shiprocket-chat-tracking-top');
    const status = createElement(
      'span',
      'shiprocket-chat-tracking-status',
      tracking.status || 'Shipment update',
    );
    const reference = createElement(
      'span',
      'shiprocket-chat-tracking-ref',
      tracking.awb ? 'AWB ' + tracking.awb : tracking.order_id ? 'Order ' + tracking.order_id : '',
    );

    top.appendChild(status);

    if (reference.textContent) {
      top.appendChild(reference);
    }

    card.appendChild(top);

    if (tracking.last_location) {
      card.appendChild(
        createElement(
          'p',
          'shiprocket-chat-tracking-line',
          'Last location: ' + tracking.last_location,
        ),
      );
    }

    if (tracking.expected_delivery) {
      card.appendChild(
        createElement(
          'p',
          'shiprocket-chat-tracking-line',
          'Expected delivery: ' + tracking.expected_delivery,
        ),
      );
    }

    return card;
  }

  function createMessageNode(entry, options) {
    const message = createElement(
      'div',
      'shiprocket-chat-message shiprocket-chat-message--' + entry.role,
    );
    let bubbleClass;

    if (entry.role === 'assistant') {
      bubbleClass =
        'shiprocket-chat-bubble shiprocket-chat-bubble--assistant' +
        (entry.payload.success === false ? ' shiprocket-chat-bubble--error' : '');
    } else {
      bubbleClass = 'shiprocket-chat-bubble shiprocket-chat-bubble--user';
    }

    const bubble = createElement('div', bubbleClass);
    const resolvedText =
      options && Object.prototype.hasOwnProperty.call(options, 'text')
        ? options.text
        : entry.role === 'assistant'
          ? entry.payload.reply
          : entry.payload.text;
    const text = createElement(
      'p',
      'shiprocket-chat-text',
      resolvedText,
    );

    bubble.appendChild(text);

    if (entry.role === 'assistant' && !(options && options.deferTrackingCard)) {
      const card = renderTrackingCard(entry.payload);

      if (card) {
        bubble.appendChild(card);
      }
    }

    message.appendChild(bubble);
    return {
      message: message,
      bubble: bubble,
      text: text,
    };
  }

  function renderMessages(container, messages) {
    container.innerHTML = '';

    messages.forEach(function each(entry) {
      container.appendChild(createMessageNode(entry).message);
    });

    scrollToBottom(container);
  }

  async function animateAssistantMessage(container, payload) {
    const entry = {
      role: 'assistant',
      payload: payload,
    };
    const nodes = createMessageNode(entry, {
      text: '',
      deferTrackingCard: true,
    });
    const fullText = String(payload.reply || '');
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    container.appendChild(nodes.message);
    scrollToBottom(container);

    if (!fullText || prefersReducedMotion) {
      nodes.text.textContent = fullText;
    } else {
      const chunkSize = fullText.length > 180 ? 3 : 2;
      const delay = fullText.length > 180 ? 24 : 34;

      for (let cursor = chunkSize; cursor <= fullText.length; cursor += chunkSize) {
        nodes.text.textContent = fullText.slice(0, cursor);
        scrollToBottom(container);
        await wait(delay);
      }

      if (nodes.text.textContent !== fullText) {
        nodes.text.textContent = fullText;
      }
    }

    const trackingCard = renderTrackingCard(payload);

    if (trackingCard) {
      nodes.bubble.appendChild(trackingCard);
    }

    scrollToBottom(container);
  }

  function renderSuggestions(container, suggestions, onSelect) {
    container.innerHTML = '';

    (suggestions && suggestions.length ? suggestions : defaultSuggestions).forEach(function each(item) {
      const button = createButton('shiprocket-chat-suggestion', item);

      button.addEventListener('click', function onClick() {
        onSelect(item);
      });

      container.appendChild(button);
    });
  }

  function renderStarterPrompts(container, onSelect) {
    container.innerHTML = '';

    starterPrompts.forEach(function each(prompt) {
      const button = createButton('shiprocket-chat-prompt', prompt);

      button.addEventListener('click', function onClick() {
        onSelect(prompt);
      });

      container.appendChild(button);
    });
  }

  function createWidget(root) {
    if (root.dataset.initialized === 'true') {
      return;
    }

    root.dataset.initialized = 'true';

    const heading = root.dataset.heading || 'Store assistant';
    const description =
      root.dataset.description ||
      'Ask about products, collections, price, stock availability, or enter AWB / order ID for tracking.';
    const launcherLabel = root.dataset.launcherLabel || 'Chat with us';
    const placeholder = root.dataset.placeholder || 'Ask products, collections, or enter AWB / Order ID';
    const buttonLabel = root.dataset.buttonLabel || 'Send';
    const proxyPath = root.dataset.proxyPath || '/apps/track-order/chat';
    const autoOpen = root.dataset.autoOpen === 'true';
    const storageKey = sessionKeyPrefix + (root.id || 'default');
    const storedState = readSessionState(storageKey);
    const state = {
      messages: storedState.messages,
      suggestions: storedState.suggestions,
    };

    const launcher = createButton('shiprocket-chat-launcher');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', launcherLabel);

    const launcherIcon = createElement('span', 'shiprocket-chat-launcher-icon');
    const launcherIconBubble = createElement('span', 'shiprocket-chat-icon-bubble');
    const launcherCard = createElement('span', 'shiprocket-chat-launcher-card');
    const launcherTitle = createElement('strong', 'shiprocket-chat-launcher-title', launcherLabel);
    const launcherSubtitle = createElement(
      'span',
      'shiprocket-chat-launcher-subtitle',
      'Products, collections, tracking',
    );

    launcherIcon.appendChild(launcherIconBubble);
    launcherCard.appendChild(launcherTitle);
    launcherCard.appendChild(launcherSubtitle);
    launcher.appendChild(launcherIcon);
    launcher.appendChild(launcherCard);

    const panel = createElement('section', 'shiprocket-chat-panel');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', heading);

    const utilityBar = createElement('div', 'shiprocket-chat-meta');
    const utilityBarMain = createElement('div', 'shiprocket-chat-meta-main');
    const utilityBarDot = createElement('span', 'shiprocket-chat-meta-dot');
    const utilityBarTitle = createElement('strong', 'shiprocket-chat-meta-title', heading);
    const utilityBarActions = createElement('div', 'shiprocket-chat-meta-actions');
    const resetButton = createButton('shiprocket-chat-action', 'New');
    const closeButton = createButton(
      'shiprocket-chat-action shiprocket-chat-action--ghost shiprocket-chat-action--icon',
      '\u00D7',
    );

    closeButton.setAttribute('aria-label', 'Close chat');
    closeButton.title = 'Close chat';

    utilityBarMain.appendChild(utilityBarDot);
    utilityBarMain.appendChild(utilityBarTitle);
    utilityBarActions.appendChild(resetButton);
    utilityBarActions.appendChild(closeButton);
    utilityBar.appendChild(utilityBarMain);
    utilityBar.appendChild(utilityBarActions);

    const body = createElement('div', 'shiprocket-chat-body');
    const intro = createElement('div', 'shiprocket-chat-intro');
    const introBadge = createElement('span', 'shiprocket-chat-intro-badge', 'Products + tracking');
    const introCopy = createElement(
      'p',
      'shiprocket-chat-intro-copy',
      description,
    );
    const promptRow = createElement('div', 'shiprocket-chat-prompt-row');
    intro.appendChild(introBadge);
    intro.appendChild(introCopy);
    intro.appendChild(promptRow);

    const messages = createElement('div', 'shiprocket-chat-messages');
    messages.setAttribute('aria-live', 'polite');

    body.appendChild(intro);
    body.appendChild(messages);

    const suggestions = createElement('div', 'shiprocket-chat-suggestions');

    const composer = createElement('form', 'shiprocket-chat-composer');
    const input = createElement('textarea', 'shiprocket-chat-input');
    const sendButton = createButton('shiprocket-chat-send', buttonLabel, 'submit');

    input.name = 'message';
    input.rows = 1;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', 'Chat message');

    composer.appendChild(input);
    composer.appendChild(sendButton);

    panel.appendChild(utilityBar);
    panel.appendChild(body);
    panel.appendChild(suggestions);
    panel.appendChild(composer);

    root.appendChild(launcher);
    root.appendChild(panel);

    renderStarterPrompts(promptRow, submitPrompt);

    let typingNode = null;

    function persistState() {
      writeSessionState(storageKey, state);
    }

    function updateIntroVisibility() {
      const shouldHide = state.messages.length > 0;
      root.classList.toggle('shiprocket-chat-has-messages', shouldHide);
      intro.hidden = shouldHide;
    }

    function seedConversation(forceReset) {
      if (forceReset) {
        state.messages = [];
      }

      if (!state.suggestions.length) {
        state.suggestions = defaultSuggestions.slice();
      }

      persistState();
      renderMessages(messages, state.messages);
      renderSuggestions(suggestions, state.suggestions, submitPrompt);
      updateIntroVisibility();
    }

    function setPanelState(isOpen) {
      root.classList.toggle('is-open', isOpen);
      launcher.setAttribute('aria-expanded', String(isOpen));
      panel.setAttribute('aria-hidden', String(!isOpen));

      if (isOpen) {
        seedConversation(false);
        scrollToBottom(messages);
        input.focus();
      }
    }

    function setLoading(isLoading) {
      sendButton.disabled = isLoading;
      input.disabled = isLoading;
      resetButton.disabled = isLoading;
      sendButton.textContent = isLoading ? '...' : buttonLabel;

      if (isLoading && !typingNode) {
        typingNode = createTypingNode();
        messages.appendChild(typingNode);
        scrollToBottom(messages);
      }

      if (!isLoading && typingNode) {
        typingNode.remove();
        typingNode = null;
      }
    }

    async function submitPrompt(rawMessage) {
      const message = String(rawMessage || '').trim();

      if (!message) {
        return;
      }

      if (!root.classList.contains('is-open')) {
        setPanelState(true);
      } else {
        seedConversation(false);
      }

      state.messages.push({
        role: 'user',
        payload: {
          text: message,
        },
      });
      state.messages = state.messages.slice(-maxStoredMessages);
      persistState();
      renderMessages(messages, state.messages);
      updateIntroVisibility();

      input.value = '';
      input.style.height = 'auto';
      setLoading(true);

      try {
        const response = await fetch(proxyPath, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: message }),
        });
        const payload = await parseJsonSafe(response);
        const finalPayload =
          payload && payload.reply
            ? payload
            : {
                success: false,
                reply: 'The assistant could not answer right now. Please try again shortly.',
                suggestions: defaultSuggestions,
              };

        state.messages.push({
          role: 'assistant',
          payload: finalPayload,
        });
        state.messages = state.messages.slice(-maxStoredMessages);
        state.suggestions =
          Array.isArray(finalPayload.suggestions) && finalPayload.suggestions.length
            ? finalPayload.suggestions.slice(0, 4)
            : defaultSuggestions.slice();
        persistState();
        if (typingNode) {
          typingNode.remove();
          typingNode = null;
        }
        await animateAssistantMessage(messages, finalPayload);
        renderSuggestions(suggestions, state.suggestions, submitPrompt);
        updateIntroVisibility();
      } catch (error) {
        const fallbackPayload = {
          success: false,
          reply: 'The assistant could not connect right now. Please try again in a moment.',
        };

        state.messages.push({
          role: 'assistant',
          payload: fallbackPayload,
        });
        state.messages = state.messages.slice(-maxStoredMessages);
        state.suggestions = defaultSuggestions.slice();
        persistState();
        if (typingNode) {
          typingNode.remove();
          typingNode = null;
        }
        await animateAssistantMessage(messages, fallbackPayload);
        renderSuggestions(suggestions, state.suggestions, submitPrompt);
        updateIntroVisibility();
      } finally {
        setLoading(false);
      }
    }

    function resetConversation() {
      state.messages = [];
      state.suggestions = defaultSuggestions.slice();
      seedConversation(true);
      input.value = '';
      input.style.height = 'auto';
      input.focus();
    }

    launcher.addEventListener('click', function onLauncherClick() {
      setPanelState(true);
    });

    closeButton.addEventListener('click', function onCloseClick() {
      setPanelState(false);
    });

    resetButton.addEventListener('click', function onResetClick() {
      resetConversation();
    });

    composer.addEventListener('submit', function onComposerSubmit(event) {
      event.preventDefault();
      submitPrompt(input.value);
    });

    input.addEventListener('input', function autoResize() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', function onKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitPrompt(input.value);
      }
    });

    updateIntroVisibility();

    if (autoOpen) {
      window.requestAnimationFrame(function onFrame() {
        setPanelState(true);
      });
    }
  }

  function initialize() {
    document.querySelectorAll(rootSelector).forEach(createWidget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
    return;
  }

  initialize();
})();
