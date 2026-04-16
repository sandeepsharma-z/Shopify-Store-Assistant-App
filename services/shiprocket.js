const axios = require('axios');

const { HttpError } = require('../utils/httpError');
const logger = require('../utils/logger');
const {
  buildReply,
  formatHumanDate,
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

const authCache = {
  token: null,
  expiresAt: 0,
  pendingPromise: null,
};

function clearAuthCache() {
  authCache.token = null;
  authCache.expiresAt = 0;
  authCache.pendingPromise = null;
}

function getShiprocketCredentials() {
  const email = (process.env.SHIPROCKET_EMAIL || '').trim();
  const password = (process.env.SHIPROCKET_PASSWORD || '').trim();

  if (!email || !password) {
    throw new HttpError(
      500,
      'Tracking service credentials are missing on the server.',
      'SHIPROCKET_NOT_CONFIGURED',
    );
  }

  return { email, password };
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

  return {
    status: firstNonEmptyString([
      activity.current_status,
      activity.current_status_body,
      activity.activity,
      activity.status,
      activity.shipment_status,
      activity.event,
    ]),
    location: firstNonEmptyString([
      activity.location,
      activity.scan_location,
      activity.hub,
      activity.city,
    ]),
    date: firstNonEmptyString([
      activity.date,
      activity.activity_date,
      activity.created_at,
      activity.updated_at,
      activity.event_time,
    ]),
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
  const hasEvidence = Boolean(rawStatus || rawLocation || rawExpectedDelivery || latestActivity);

  return {
    hasEvidence,
    success: true,
    awb: lookup.awb || extractAwb(payload) || null,
    order_id: lookup.orderId || extractOrderId(payload) || null,
    status,
    last_location: lastLocation,
    expected_delivery: expectedDelivery,
    reply: buildReply({
      status,
      lastLocation,
      expectedDelivery,
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

async function authenticate() {
  if (authCache.token && Date.now() < authCache.expiresAt) {
    return authCache.token;
  }

  if (authCache.pendingPromise) {
    return authCache.pendingPromise;
  }

  authCache.pendingPromise = (async () => {
    const credentials = getShiprocketCredentials();

    try {
      const response = await shiprocketClient.post('/auth/login', credentials);
      const token = response.data?.token;

      if (!token) {
        throw new HttpError(502, 'Shiprocket authentication failed.', 'SHIPROCKET_AUTH_FAILED');
      }

      authCache.token = token;
      authCache.expiresAt = Date.now() + SHIPROCKET_TOKEN_TTL_MS;

      logger.info('Shiprocket token cached', {
        expiresAt: new Date(authCache.expiresAt).toISOString(),
      });

      return token;
    } catch (error) {
      clearAuthCache();
      throw mapShiprocketError(error);
    } finally {
      authCache.pendingPromise = null;
    }
  })();

  return authCache.pendingPromise;
}

async function requestWithAuth(config, allowRetry = true) {
  const token = await authenticate();

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
      clearAuthCache();
      const freshToken = await authenticate();

      return shiprocketClient.request({
        ...config,
        headers: {
          ...(config.headers || {}),
          Authorization: `Bearer ${freshToken}`,
        },
      });
    }

    throw error;
  }
}

async function fetchByAwb(awb) {
  try {
    const response = await requestWithAuth({
      method: 'GET',
      url: `/courier/track/awb/${encodeURIComponent(awb)}`,
    });
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

async function fetchOrderDetails(orderId) {
  const response = await requestWithAuth({
    method: 'GET',
    url: `/orders/show/${encodeURIComponent(orderId)}`,
  });

  return response.data;
}

async function fetchByOrderId(orderId) {
  try {
    const orderPayload = await fetchOrderDetails(orderId);
    const awb = extractAwb(orderPayload);

    if (awb) {
      try {
        const liveTracking = await fetchByAwb(awb);
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

async function fetchTracking({ awb, orderId }) {
  if (awb) {
    return fetchByAwb(awb);
  }

  return fetchByOrderId(orderId);
}

module.exports = {
  fetchTracking,
  clearAuthCache,
};
