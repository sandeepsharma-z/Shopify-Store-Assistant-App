(function bootstrapOrderAssistant() {
  const rootSelector = '.shiprocket-order-tracker-root';
  const sessionKeyPrefix = 'shiprocket-order-assistant:v8:';
  const maxStoredMessages = 30;
  const defaultSuggestions = [
    'Track my order',
    'Find products',
    'Browse collections',
    'Shipping policy',
  ];
  const launcherHighlights = [
    'Track orders instantly',
    'Discover top products',
    'Browse fresh collections',
    'Get live delivery updates',
  ];
  const starterPrompts = [
    'Track my order',
    'Find products',
    'Browse collections',
    'Shipping policy',
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

  function startLauncherTextRotation(node, phrases) {
    if (!node || !Array.isArray(phrases) || phrases.length < 2) {
      return;
    }

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      node.textContent = phrases[0];
      return;
    }

    let index = 0;

    node.textContent = phrases[index];

    window.setInterval(function rotateText() {
      node.classList.add('is-changing');

      window.setTimeout(function swapText() {
        index = (index + 1) % phrases.length;
        node.textContent = phrases[index];
        node.classList.remove('is-changing');
      }, 220);
    }, 2600);
  }

  function isStorefrontProxyPath(pathname) {
    return typeof pathname === 'string' && /^\/apps\//.test(pathname);
  }

  function getDetectedShopDomain(fallbackValue) {
    const fallback = typeof fallbackValue === 'string' ? fallbackValue.trim() : '';
    const hostname = typeof window.location.hostname === 'string' ? window.location.hostname.trim() : '';

    if (hostname && !/^(localhost|127\.0\.0\.1)$/i.test(hostname)) {
      return hostname;
    }

    return fallback;
  }

  async function requestDirectAssistantReply(apiUrl, message, shopDomain) {
    const requestPayload = {
      message: message,
    };

    if (typeof shopDomain === 'string' && shopDomain.trim()) {
      requestPayload.shopDomain = shopDomain.trim();
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify(requestPayload),
    });

    const payload = await parseJsonSafe(response);

    return {
      ok: response.ok,
      status: response.status,
      payload: payload,
    };
  }

  async function requestAssistantReply(proxyPath, message, directApiUrl, shopDomain) {
    const normalizedPath = typeof proxyPath === 'string' && proxyPath.trim() ? proxyPath.trim() : '/apps/track-order/chat';
    const normalizedDirectApiUrl =
      typeof directApiUrl === 'string' && directApiUrl.trim() ? directApiUrl.trim() : '';

    if (isStorefrontProxyPath(normalizedPath)) {
      const url = new URL(normalizedPath, window.location.origin);

      url.searchParams.set('message', message);
      url.searchParams.set('_client', 'widget');

      const proxyResponse = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const proxyPayload = await parseJsonSafe(proxyResponse);

      if (proxyResponse.ok && proxyPayload && typeof proxyPayload.reply === 'string' && proxyPayload.reply.trim()) {
        return proxyPayload;
      }

      if (normalizedDirectApiUrl) {
        const directResponse = await requestDirectAssistantReply(
          normalizedDirectApiUrl,
          message,
          shopDomain,
        );

        if (directResponse.payload && typeof directResponse.payload.reply === 'string' && directResponse.payload.reply.trim()) {
          return directResponse.payload;
        }
      }

      return proxyPayload;
    }

    const directResponse = await requestDirectAssistantReply(normalizedPath, message, shopDomain);
    return directResponse.payload;
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

  function formatLabelText(value) {
    if (!value) {
      return '';
    }

    const text = String(value).trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function truncateText(value, maxLength) {
    if (!value) {
      return '';
    }

    const text = String(value).trim();

    if (text.length <= maxLength) {
      return text;
    }

    return text.slice(0, maxLength - 1).trim() + '\u2026';
  }

  function toTitleWords(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b\w/g, function each(character) {
        return character.toUpperCase();
      });
  }

  function getCourierBadgeLines(courierName) {
    const cleanedName = String(courierName || 'Tracking')
      .replace(/[^a-z0-9 ]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleanedName.split(' ').filter(Boolean);

    if (!words.length) {
      return ['TRACK', 'ORDER'];
    }

    if (words.length === 1) {
      const word = words[0].toUpperCase();

      if (word.length <= 6) {
        return [word, 'TRACK'];
      }

      return [word.slice(0, 6), word.slice(6, 12) || 'TRACK'];
    }

    return [words[0].slice(0, 6).toUpperCase(), words[1].slice(0, 6).toUpperCase()];
  }

  function formatTimelineActivity(value) {
    if (!value) {
      return 'Shipment Update';
    }

    let text = String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

    if (
      !/^shipment\b/i.test(text) &&
      /(delivered|outscan|inscan|in transit|booked|manifest|return delivered|return in transit)/i.test(text)
    ) {
      text = 'Shipment ' + text;
    }

    return toTitleWords(text);
  }

  function formatTimelineLocation(value) {
    if (!value) {
      return 'Location not available';
    }

    return toTitleWords(String(value).replace(/\s+/g, ' ').trim());
  }

  function getTimelineStamp(rawValue) {
    const monthMap = {
      january: 'JAN',
      february: 'FEB',
      march: 'MAR',
      april: 'APR',
      may: 'MAY',
      june: 'JUN',
      july: 'JUL',
      august: 'AUG',
      september: 'SEP',
      october: 'OCT',
      november: 'NOV',
      december: 'DEC',
      jan: 'JAN',
      feb: 'FEB',
      mar: 'MAR',
      apr: 'APR',
      jun: 'JUN',
      jul: 'JUL',
      aug: 'AUG',
      sep: 'SEP',
      sept: 'SEP',
      oct: 'OCT',
      nov: 'NOV',
      dec: 'DEC',
    };

    if (!rawValue) {
      return {
        date: 'LATEST',
        time: '',
      };
    }

    const parsedDate = new Date(rawValue);

    if (!Number.isNaN(parsedDate.getTime())) {
      return {
        date: new Intl.DateTimeFormat('en-US', {
          day: '2-digit',
          month: 'short',
        }).format(parsedDate).replace(',', '').toUpperCase(),
        time: new Intl.DateTimeFormat('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }).format(parsedDate).toUpperCase(),
      };
    }

    const cleaned = String(rawValue).trim();
    const match = cleaned.match(/(\d{1,2})\s+([a-z]+)(?:\s+at\s+(\d{1,2}:\d{2}\s*[ap]\.?m\.?))?/i);

    if (match) {
      return {
        date: match[1].padStart(2, '0') + ' ' + (monthMap[match[2].toLowerCase()] || match[2].slice(0, 3).toUpperCase()),
        time: match[3] ? match[3].replace(/\./g, '').toUpperCase() : '',
      };
    }

    return {
      date: truncateText(cleaned.toUpperCase(), 11),
      time: '',
    };
  }

  function renderTrackingCard(payload) {
    if (!payload || !payload.tracking) {
      return null;
    }

    const tracking = payload.tracking;
    const card = createElement('div', 'shiprocket-chat-tracking-card');
    const head = createElement('div', 'shiprocket-chat-tracking-head');
    const brand = createElement('div', 'shiprocket-chat-tracking-brand');
    const badge = createElement('div', 'shiprocket-chat-tracking-badge');
    const badgeLines = getCourierBadgeLines(tracking.courier_name);
    const badgePrimary = createElement('span', 'shiprocket-chat-tracking-badge-line is-primary', badgeLines[0]);
    const badgeSecondary = createElement('span', 'shiprocket-chat-tracking-badge-line is-secondary', badgeLines[1]);
    const brandCopy = createElement('div', 'shiprocket-chat-tracking-brand-copy');
    const courier = createElement(
      'strong',
      'shiprocket-chat-tracking-courier',
      tracking.courier_name || 'Shipment tracking',
    );
    const courierMeta = createElement(
      'span',
      'shiprocket-chat-tracking-courier-meta',
      formatLabelText(tracking.status || tracking.latest_event || 'Shipment update'),
    );
    const headMeta = createElement('div', 'shiprocket-chat-tracking-head-meta');
    const headLabel = createElement(
      'span',
      'shiprocket-chat-tracking-head-label',
      tracking.awb ? 'Tracking ID' : 'Order ID',
    );
    const headValue = createElement(
      'strong',
      'shiprocket-chat-tracking-head-value',
      tracking.awb || tracking.order_id || 'Unavailable',
    );

    badge.appendChild(badgePrimary);
    badge.appendChild(badgeSecondary);
    brandCopy.appendChild(courier);
    brandCopy.appendChild(courierMeta);
    brand.appendChild(badge);
    brand.appendChild(brandCopy);
    headMeta.appendChild(headLabel);
    headMeta.appendChild(headValue);
    head.appendChild(brand);
    head.appendChild(headMeta);
    card.appendChild(head);

    const submetaValues = [];

    if (tracking.last_location) {
      submetaValues.push('Location: ' + tracking.last_location);
    }

    if (tracking.expected_delivery) {
      submetaValues.push('Expected: ' + tracking.expected_delivery);
    }

    if (tracking.order_id && tracking.awb) {
      submetaValues.push('Order: ' + tracking.order_id);
    }

    if (submetaValues.length) {
      card.appendChild(
        createElement(
          'p',
          'shiprocket-chat-tracking-submeta',
          submetaValues.join('  •  '),
        ),
      );
    }

    const timelineItems =
      Array.isArray(tracking.recent_updates) && tracking.recent_updates.length
        ? tracking.recent_updates.slice(0, 6)
        : [
            {
              raw_status: tracking.latest_event || tracking.status,
              status: tracking.latest_event || tracking.status,
              location: tracking.last_location,
              raw_date: tracking.last_update_at,
              date: tracking.last_update_at,
            },
          ];

    if (timelineItems.length) {
      const timeline = createElement('div', 'shiprocket-chat-tracking-timeline');

      timelineItems.forEach(function each(update, index) {
        const stamp = getTimelineStamp(update.raw_date || update.date);
        const item = createElement(
          'div',
          'shiprocket-chat-tracking-timeline-item' + (index === 0 ? ' is-current' : ''),
        );
        const timeBlock = createElement('div', 'shiprocket-chat-tracking-timeline-stamp');
        const date = createElement('strong', 'shiprocket-chat-tracking-date', stamp.date);
        const time = createElement('span', 'shiprocket-chat-tracking-time', stamp.time);
        const rail = createElement('div', 'shiprocket-chat-tracking-rail');
        const dot = createElement('span', 'shiprocket-chat-tracking-dot');
        const content = createElement('div', 'shiprocket-chat-tracking-content');
        const activity = createElement('p', 'shiprocket-chat-tracking-activity');
        const activityLabel = createElement('span', 'shiprocket-chat-tracking-field-label', 'Activity:');
        const activityValue = createElement(
          'strong',
          'shiprocket-chat-tracking-field-value',
          formatTimelineActivity(update.raw_status || update.status),
        );
        const location = createElement('p', 'shiprocket-chat-tracking-location');
        const locationLabel = createElement('span', 'shiprocket-chat-tracking-field-label', 'Location:');
        const locationValue = createElement(
          'strong',
          'shiprocket-chat-tracking-field-value',
          formatTimelineLocation(update.location),
        );

        timeBlock.appendChild(date);

        if (time.textContent) {
          timeBlock.appendChild(time);
        }

        rail.appendChild(dot);
        activity.appendChild(activityLabel);
        activity.appendChild(activityValue);
        location.appendChild(locationLabel);
        location.appendChild(locationValue);
        content.appendChild(activity);
        content.appendChild(location);
        item.appendChild(timeBlock);
        item.appendChild(rail);
        item.appendChild(content);
        timeline.appendChild(item);
      });

      card.appendChild(timeline);
    }

    if (tracking.track_url) {
      const link = createElement('a', 'shiprocket-chat-tracking-link', 'Open tracking page');
      link.href = tracking.track_url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      card.appendChild(link);
    }

    return card;
  }

  function createMetaPill(text, modifierClass) {
    const pill = createElement(
      'span',
      'shiprocket-chat-catalog-pill' + (modifierClass ? ' ' + modifierClass : ''),
      text,
    );
    return pill;
  }

  function renderProductItem(item) {
    const card = createElement('article', 'shiprocket-chat-catalog-item');
    const top = createElement('div', 'shiprocket-chat-catalog-item-top');
    const title = createElement('strong', 'shiprocket-chat-catalog-item-title', item.title || 'Product');
    const price = createElement('span', 'shiprocket-chat-catalog-item-price', item.price || '');
    const meta = createElement('div', 'shiprocket-chat-catalog-item-meta');
    const footer = createElement('div', 'shiprocket-chat-catalog-item-footer');

    top.appendChild(title);

    if (price.textContent) {
      top.appendChild(price);
    }

    meta.appendChild(
      createMetaPill(item.available ? 'In stock' : 'Out of stock', item.available ? 'is-success' : 'is-muted'),
    );

    if (item.vendor) {
      meta.appendChild(createMetaPill(item.vendor));
    }

    if (item.productType) {
      meta.appendChild(createMetaPill(item.productType));
    }

    if (item.compare_at_price && item.compare_at_price !== item.price) {
      meta.appendChild(createMetaPill('Sale'));
    }

    card.appendChild(top);
    card.appendChild(meta);

    if (item.description) {
      card.appendChild(
        createElement(
          'p',
          'shiprocket-chat-catalog-item-copy',
          truncateText(item.description, 120),
        ),
      );
    }

    if (item.url) {
      const link = createElement('a', 'shiprocket-chat-catalog-item-link', 'View product');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      footer.appendChild(link);
      card.appendChild(footer);
    }

    return card;
  }

  function renderCollectionItem(item) {
    const card = createElement('article', 'shiprocket-chat-catalog-item');
    const top = createElement('div', 'shiprocket-chat-catalog-item-top');
    const title = createElement(
      'strong',
      'shiprocket-chat-catalog-item-title',
      item.title || 'Collection',
    );
    const meta = createElement('div', 'shiprocket-chat-catalog-item-meta');

    top.appendChild(title);
    card.appendChild(top);

    if (item.products && item.products.length) {
      meta.appendChild(createMetaPill(item.products.length + ' sample products'));
    }

    card.appendChild(meta);

    if (item.description) {
      card.appendChild(
        createElement(
          'p',
          'shiprocket-chat-catalog-item-copy',
          truncateText(item.description, 120),
        ),
      );
    }

    if (item.products && item.products.length) {
      card.appendChild(
        createElement(
          'p',
          'shiprocket-chat-catalog-item-copy',
          'Includes: ' +
            item.products
              .slice(0, 3)
              .map(function mapProduct(product) {
                return product.title;
              })
              .filter(Boolean)
              .join(', '),
        ),
      );
    }

    if (item.url) {
      const link = createElement('a', 'shiprocket-chat-catalog-item-link', 'Open collection');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      card.appendChild(link);
    }

    return card;
  }

  function renderOverviewBlock(catalog) {
    const wrapper = createElement('div', 'shiprocket-chat-catalog-card');
    const title = createElement('strong', 'shiprocket-chat-catalog-title', 'Store overview');
    const grid = createElement('div', 'shiprocket-chat-catalog-grid');

    wrapper.appendChild(title);

    if (catalog.shop && (catalog.shop.name || catalog.shop.url)) {
      const summary = createElement(
        'p',
        'shiprocket-chat-catalog-summary',
        catalog.shop.name || catalog.shop.url,
      );
      wrapper.appendChild(summary);
    }

    (catalog.products || []).slice(0, 2).forEach(function each(item) {
      grid.appendChild(renderProductItem(item));
    });

    (catalog.collections || []).slice(0, 2).forEach(function each(item) {
      grid.appendChild(renderCollectionItem(item));
    });

    if (grid.childNodes.length) {
      wrapper.appendChild(grid);
    }

    return wrapper;
  }

  function renderCatalogCard(payload) {
    if (!payload || !payload.catalog) {
      return null;
    }

    const catalog = payload.catalog;

    if (catalog.type === 'overview') {
      return renderOverviewBlock(catalog);
    }

    if (!Array.isArray(catalog.items) || !catalog.items.length) {
      return null;
    }

    const wrapper = createElement('div', 'shiprocket-chat-catalog-card');
    const titleText = catalog.type === 'collections' ? 'Collections' : 'Products';
    const title = createElement('strong', 'shiprocket-chat-catalog-title', titleText);
    const grid = createElement('div', 'shiprocket-chat-catalog-grid');

    wrapper.appendChild(title);

    catalog.items.slice(0, 4).forEach(function each(item) {
      if (catalog.type === 'collections') {
        grid.appendChild(renderCollectionItem(item));
        return;
      }

      grid.appendChild(renderProductItem(item));
    });

    wrapper.appendChild(grid);
    return wrapper;
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
      const catalogCard = renderCatalogCard(entry.payload);

      if (card) {
        bubble.appendChild(card);
      }

      if (catalogCard) {
        bubble.appendChild(catalogCard);
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
    const catalogCard = renderCatalogCard(payload);

    if (trackingCard) {
      nodes.bubble.appendChild(trackingCard);
    }

    if (catalogCard) {
      nodes.bubble.appendChild(catalogCard);
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
      'Ask about products, collections, prices, availability, shipping, returns, or enter AWB / order ID for live tracking.';
    const launcherLabel = root.dataset.launcherLabel || 'Chat with us';
    const configuredPlaceholder =
      root.dataset.placeholder || 'Type message, AWB or order ID';
    const placeholder =
      configuredPlaceholder.length > 34 ? 'Type message, AWB or order ID' : configuredPlaceholder;
    const buttonLabel = root.dataset.buttonLabel || 'Send';
    const proxyPath = root.dataset.proxyPath || '/apps/track-order/chat';
    const directApiUrl =
      root.dataset.directApiUrl ||
      'https://shopify-store-assistant-app.vercel.app/api/chatbot';
    const shopDomain = getDetectedShopDomain(root.dataset.shopDomain || '');
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
      launcherHighlights[0],
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
    const introBadge = createElement('span', 'shiprocket-chat-intro-badge', 'Store + tracking');
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
    const input = createElement('input', 'shiprocket-chat-input');
    const sendButton = createButton('shiprocket-chat-send', buttonLabel, 'submit');

    input.name = 'message';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
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

    startLauncherTextRotation(launcherSubtitle, launcherHighlights);
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
      setLoading(true);

      try {
        const payload = await requestAssistantReply(proxyPath, message, directApiUrl, shopDomain);
        const finalPayload =
          payload && typeof payload.reply === 'string' && payload.reply.trim()
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

    input.addEventListener('keydown', function onKeyDown(event) {
      if (event.key === 'Enter') {
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
