const axios = require('axios');

const { HttpError } = require('../utils/httpError');
const logger = require('../utils/logger');
const { buildRuntimeSettings } = require('./storeSettings');
const {
  buildReply,
  formatHumanDate,
  formatHumanDateTime,
  normalizeLocation,
  normalizeStatus,
} = require('../utils/trackFormatter');

const SHIPROCKET_BASE_URL =
  process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';
const SHIPROCKET_TIMEOUT_MS = Number(process.env.SHIPROCKET_TIMEOUT_MS || 15000);
const SHIPROCKET_TOKEN_TTL_MS = Number(
  process.env.SHIPROCKET_TOKEN_TTL_MS || 10 * 24 * 60 * 60 * 1000,
);

const shiprocketClient = axios.create({
  baseURL: SHIPROCKET_BASE_URL,
  timeout: SHIPROCKET_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

const authCacheByKey = new Map();

function clearAuthCache() {
  authCacheByKey.clear();
}

function getAuthCacheEntry(cacheKey) {
  if (!authCacheByKey.has(cacheKey)) {
    authCacheByKey.set(cacheKey, {
      token: null,
      expiresAt: 0,
      pendingPromise: null,
    });
  }

  return authCacheByKey.get(cacheKey);
}

function clearAuthCacheEntry(cacheKey) {
  authCacheByKey.delete(cacheKey);
}

function getShiprocketCredentials(shopDomain) {
  const runtime = buildRuntimeSettings(shopDomain);
  const email = String(runtime.shiprocketEmail || '').trim();
  const password = String(runtime.shiprocketPassword || '').trim();

  if (!email || !password) {
    throw new HttpError(
      500,
      'Tracking service credentials are missing on the server.',
      'SHIPROCKET_NOT_CONFIGURED',
    );
  }

  return {
    email,
    password,
    cacheKey: email.toLowerCase(),
  };
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeActivity(activity) {
  if (!activity || typeof activity !== 'object') {
    return null;
  }

  const rawStatus = firstNonEmptyString([
    activity.current_status,
    activity.current_status_body,
    activity.activity,
    activity.status,
    activity.shipment_status,
    activity.event,
  ]);
  const rawLocation = firstNonEmptyString([
    activity.location,
    activity.scan_location,
    activity.hub,
    activity.city,
  ]);
  const rawDate = firstNonEmptyString([
    activity.date,
    activity.activity_date,
    activity.created_at,
    activity.updated_at,
    activity.event_time,
  ]);

  return {
    status: rawStatus,
    location: rawLocation,
    date: rawDate,
    normalized_status: normalizeStatus(rawStatus),
    normalized_location: normalizeLocation(rawLocation),
    formatted_date: formatHumanDateTime(rawDate),
  };
}

function sortActivitiesByDateDesc(left, right) {
  const leftTimestamp = Date.parse(left.date || '');
  const rightTimestamp = Date.parse(right.date || '');

  if (Number.isNaN(leftTimestamp) && Number.isNaN(rightTimestamp)) {
    return 0;
  }

  if (Number.isNaN(leftTimestamp)) {
    return 1;
  }

  if (Number.isNaN(rightTimestamp)) {
    return -1;
  }

  return rightTimestamp - leftTimestamp;
}

function extractTrackingRoot(payload) {
  return payload?.tracking_data || payload?.data || payload || {};
}

function extractActivities(payload) {
  const root = extractTrackingRoot(payload);
  const rawActivities = [
    ...toArray(root.shipment_track_activities),
    ...toArray(root.shipment_track),
    ...toArray(root.activities),
    ...toArray(payload?.shipment_track_activities),
    ...toArray(payload?.shipment_track),
  ];

  return rawActivities.map(normalizeActivity).filter(Boolean).sort(sortActivitiesByDateDesc);
}

function extractAwb(payload) {
  const root = extractTrackingRoot(payload);

  return firstNonEmptyString([
    root.awb_code,
    root.awb,
    root.awb_number,
    root?.shipments?.[0]?.awb,
    root?.shipments?.[0]?.awb_code,
    payload?.awb_code,
    payload?.awb,
  ]);
}

function extractOrderId(payload) {
  const root = extractTrackingRoot(payload);

  return firstNonEmptyString([
    root.order_id,
    root.channel_order_id,
    root.channel_order_no,
    payload?.order_id,
    payload?.channel_order_id,
  ]);
}

function extractCourierName(payload) {
  const root = extractTrackingRoot(payload);

  return firstNonEmptyString([
    root.courier_name,
    root.courier_company_name,
    root.shipment_courier,
    root?.shipment_track?.[0]?.courier_name,
    root?.shipments?.[0]?.courier_name,
    payload?.courier_name,
  ]);
}

function extractTrackingUrl(payload) {
  const root = extractTrackingRoot(payload);

  return firstNonEmptyString([
    root.track_url,
    root.tracking_url,
    root.awb_track_url,
    payload?.track_url,
    payload?.tracking_url,
  ]);
}

function buildRecentUpdates(activities) {
  const seen = new Set();

  return activities
    .map((activity) => ({
      status:
        activity.normalized_status &&
        !['na', 'n a', 'null', 'undefined'].includes(activity.normalized_status)
          ? activity.normalized_status
          : null,
      location: activity.normalized_location || null,
      date: activity.formatted_date || activity.date || null,
    }))
    .filter((activity) => {
      if (!activity.status && !activity.location) {
        return false;
      }

      if (!activity.location && !activity.date) {
        return false;
      }

      const signature = `${activity.status || ''}|${activity.location || ''}|${activity.date || ''}`;

      if (seen.has(signature)) {
        return false;
      }

      seen.add(signature);
      return true;
    })
    .slice(0, 4);
}

function extractTrackingSummary(payload, lookup = {}) {
  const root = extractTrackingRoot(payload);
  const activities = extractActivities(payload);
  const latestActivity = activities[0];

  const rawStatus = firstNonEmptyString([
    root.current_status,
    root.current_status_body,
    root.shipment_status_label,
    root.shipment_status,
    root.status,
    latestActivity?.status,
    payload?.status,
  ]);
  const rawLocation = firstNonEmptyString([
    latestActivity?.location,
    root.current_location,
    root.last_location,
    payload?.current_location,
    payload?.last_location,
    root.pickup_city,
  ]);
  const rawExpectedDelivery = firstNonEmptyString([
    root.etd,
    root.expected_delivery_date,
    root.edd,
    payload?.expected_delivery_date,
  ]);

  const status = normalizeStatus(rawStatus);
  const lastLocation = normalizeLocation(rawLocation);
  const expectedDelivery = formatHumanDate(rawExpectedDelivery);
  const courierName = extractCourierName(payload);
  const lastUpdateAt = formatHumanDateTime(
    firstNonEmptyString([
      latestActivity?.date,
      root.updated_at,
      root.current_timestamp,
      payload?.updated_at,
    ]),
  );
  const latestEvent = normalizeStatus(
    firstNonEmptyString([
      latestActivity?.status,
      root.current_status_body,
      root.status,
    ]),
  );
  const trackUrl = extractTrackingUrl(payload);
  const recentUpdates = buildRecentUpdates(activities);
  const hasEvidence = Boolean(rawStatus || rawLocation || rawExpectedDelivery || latestActivity);

  return {
    hasEvidence,
    success: true,
    awb: lookup.awb || extractAwb(payload) || null,
    order_id: lookup.orderId || extractOrderId(payload) || null,
    status,
    last_location: lastLocation,
    expected_delivery: expectedDelivery,
    courier_name: courierName,
    latest_event: latestEvent,
    last_update_at: lastUpdateAt,
    track_url: trackUrl,
    recent_updates: recentUpdates,
    reply: buildReply({
      status,
      lastLocation,
      expectedDelivery,
      courierName,
      lastUpdateAt,
    }),
  };
}

function mapShiprocketError(error, context = {}) {
  if (error instanceof HttpError) {
    return error;
  }

  if (!axios.isAxiosError(error)) {
    return new HttpError(
      500,
      "We couldn't fetch live tracking details right now. Please try again in a few minutes or contact support.",
      'TRACKING_LOOKUP_FAILED',
    );
  }

  const statusCode = error.response?.status;
  const apiMessage = firstNonEmptyString([
    error.response?.data?.message,
    error.response?.data?.error,
    error.response?.data?.tracking_data?.error,
  ]);

  if ([400, 404, 422].includes(statusCode)) {
    if (context.awb) {
      return new HttpError(
        400,
        'Invalid AWB number. Please check and try again.',
        'INVALID_AWB',
      );
    }

    if (context.orderId) {
      return new HttpError(
        400,
        'Invalid order ID. Please check and try again.',
        'INVALID_ORDER_ID',
      );
    }
  }

  if (statusCode === 401) {
    return new HttpError(502, 'Shiprocket authentication failed.', 'SHIPROCKET_AUTH_FAILED');
  }

  if (statusCode === 429) {
    return new HttpError(
      503,
      'Tracking service is busy right now. Please try again in a minute.',
      'SHIPROCKET_RATE_LIMIT',
    );
  }

  return new HttpError(
    502,
    apiMessage || 'Tracking provider is temporarily unavailable.',
    'SHIPROCKET_UNAVAILABLE',
  );
}

async function authenticate(shopDomain) {
  const credentials = getShiprocketCredentials(shopDomain);
  const cacheEntry = getAuthCacheEntry(credentials.cacheKey);

  if (cacheEntry.token && Date.now() < cacheEntry.expiresAt) {
    return {
      token: cacheEntry.token,
      cacheKey: credentials.cacheKey,
    };
  }

  if (cacheEntry.pendingPromise) {
    return cacheEntry.pendingPromise;
  }

  cacheEntry.pendingPromise = (async () => {

    try {
      const response = await shiprocketClient.post('/auth/login', {
        email: credentials.email,
        password: credentials.password,
      });
      const token = response.data?.token;

      if (!token) {
        throw new HttpError(502, 'Shiprocket authentication failed.', 'SHIPROCKET_AUTH_FAILED');
      }

      cacheEntry.token = token;
      cacheEntry.expiresAt = Date.now() + SHIPROCKET_TOKEN_TTL_MS;

      logger.info('Shiprocket token cached', {
        cacheKey: credentials.cacheKey,
        expiresAt: new Date(cacheEntry.expiresAt).toISOString(),
      });

      return {
        token,
        cacheKey: credentials.cacheKey,
      };
    } catch (error) {
      clearAuthCacheEntry(credentials.cacheKey);
      throw mapShiprocketError(error);
    } finally {
      cacheEntry.pendingPromise = null;
    }
  })();

  return cacheEntry.pendingPromise;
}

async function requestWithAuth(config, { shopDomain, allowRetry = true } = {}) {
  const { token, cacheKey } = await authenticate(shopDomain);

  try {
    return await shiprocketClient.request({
      ...config,
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    if (allowRetry && error.response?.status === 401) {
      clearAuthCacheEntry(cacheKey);
      const freshAuth = await authenticate(shopDomain);

      return shiprocketClient.request({
        ...config,
        headers: {
          ...(config.headers || {}),
          Authorization: `Bearer ${freshAuth.token}`,
        },
      });
    }

    throw error;
  }
}

async function fetchByAwb(awb, shopDomain) {
  try {
    const response = await requestWithAuth({
      method: 'GET',
      url: `/courier/track/awb/${encodeURIComponent(awb)}`,
    }, { shopDomain });
    const summary = extractTrackingSummary(response.data, { awb });

    if (!summary.hasEvidence) {
      throw new HttpError(
        400,
        'Invalid AWB number. Please check and try again.',
        'INVALID_AWB',
      );
    }

    delete summary.hasEvidence;
    return summary;
  } catch (error) {
    throw mapShiprocketError(error, { awb });
  }
}

async function fetchOrderDetails(orderId, shopDomain) {
  const response = await requestWithAuth({
    method: 'GET',
    url: `/orders/show/${encodeURIComponent(orderId)}`,
  }, { shopDomain });

  return response.data;
}

async function fetchByOrderId(orderId, shopDomain) {
  try {
    const orderPayload = await fetchOrderDetails(orderId, shopDomain);
    const awb = extractAwb(orderPayload);

    if (awb) {
      try {
        const liveTracking = await fetchByAwb(awb, shopDomain);
        return {
          ...liveTracking,
          order_id: orderId,
        };
      } catch (trackingError) {
        logger.warn('Falling back to order payload after live tracking lookup failed', {
          orderId,
          awb,
          message: trackingError.message,
        });
      }
    }

    const summary = extractTrackingSummary(orderPayload, { orderId, awb });

    if (!summary.hasEvidence && !awb) {
      throw new HttpError(
        400,
        'Invalid order ID. Please check and try again.',
        'INVALID_ORDER_ID',
      );
    }

    delete summary.hasEvidence;
    return summary;
  } catch (error) {
    throw mapShiprocketError(error, { orderId });
  }
}

async function fetchTracking({ awb, orderId, shopDomain }) {
  if (awb) {
    return fetchByAwb(awb, shopDomain);
  }

  return fetchByOrderId(orderId, shopDomain);
}

module.exports = {
  fetchTracking,
  clearAuthCache,
};
