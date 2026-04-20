(function bootstrapAppHome() {
  const config = window.__SHOPIFY_APP_HOME__;

  if (!config) {
    return;
  }

  const form = document.getElementById('app-home-settings-form');
  if (!form) {
    return;
  }

  const alertNode = document.getElementById('app-home-alert');
  const metaNode = document.getElementById('app-home-meta');
  const saveButton = document.getElementById('app-home-save-button');
  const geminiHint = document.getElementById('geminiApiKeyHint');

  function getField(id) {
    return document.getElementById(id);
  }

  function setAlert(message, type) {
    if (!message) {
      alertNode.hidden = true;
      alertNode.textContent = '';
      alertNode.className = 'app-home-alert';
      return;
    }

    alertNode.hidden = false;
    alertNode.textContent = message;
    alertNode.className = 'app-home-alert is-' + (type || 'info');
  }

  function setDisabled(disabled) {
    Array.prototype.forEach.call(form.elements, function each(element) {
      element.disabled = Boolean(disabled);
    });
  }

  function fillForm(payload) {
    const settings = (payload && payload.settings) || {};

    getField('shopDomain').value = payload && payload.shopDomain ? payload.shopDomain : config.shopDomain || '';
    getField('geminiApiKey').value = '';
    geminiHint.textContent = settings.hasGeminiApiKey
      ? 'A Gemini API key is already saved. Leave blank to keep it.'
      : 'No Gemini API key saved yet.';

    metaNode.textContent = payload && payload.updatedAt ? 'Last updated: ' + payload.updatedAt : '';
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(function fallback() {
      return {};
    });

    if (!response.ok || payload.success === false) {
      throw new Error(payload.reply || payload.message || 'Request failed.');
    }

    return payload;
  }

  async function loadSettings() {
    if (!config.canEdit || !config.shopDomain) {
      fillForm({ shopDomain: config.shopDomain || '' });
      setDisabled(true);
      setAlert(
        config.shopDomain
          ? 'Open this page from Shopify admin to edit settings for this store.'
          : 'Shop domain was not detected. Open the app from Shopify admin so the correct store can be loaded.',
        'info',
      );
      return;
    }

    setAlert('Loading saved settings...', 'info');

    try {
      const payload = await requestJson(
        config.endpoints.settings + '?shop=' + encodeURIComponent(config.shopDomain),
        {
          headers: {
            'x-settings-token': config.settingsToken,
          },
        },
      );

      fillForm(payload);
      setDisabled(false);
      setAlert('Settings loaded. Update any field and save.', 'info');
    } catch (error) {
      fillForm({ shopDomain: config.shopDomain });
      setDisabled(false);
      setAlert(error.message, 'error');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!config.canEdit) {
      setAlert('This page is read-only until it is opened from Shopify admin.', 'error');
      return;
    }

    saveButton.disabled = true;
    setAlert('Saving settings...', 'info');

    const payload = {
      shopDomain: getField('shopDomain').value.trim(),
      embedded: config.embeddedAdminContext ? '1' : '0',
      settings: {
        geminiApiKey: getField('geminiApiKey').value.trim(),
      },
    };

    try {
      const response = await requestJson(config.endpoints.settings, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-settings-token': config.settingsToken,
        },
        body: JSON.stringify(payload),
      });

      fillForm(response);
      setAlert(response.message || 'Settings saved successfully.', 'success');
    } catch (error) {
      setAlert(error.message, 'error');
    } finally {
      saveButton.disabled = false;
    }
  }

  form.addEventListener('submit', handleSubmit);
  loadSettings();
})();
