function toTitleCase(value) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function normalizeStatus(rawStatus) {
  if (!rawStatus) {
    return 'being processed';
  }

  const cleaned = String(rawStatus).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  const statusMap = {
    ofd: 'out for delivery',
    delivered: 'delivered',
    'pickup scheduled': 'pickup scheduled',
    'shipment booked': 'shipment booked',
    'manifest generated': 'manifest generated',
    'in transit': 'in transit',
    'rto in transit': 'return in transit',
    'return in transit': 'return in transit',
    'rto delivered': 'return delivered',
    'return delivered': 'return delivered',
    cancelled: 'cancelled',
  };

  return statusMap[cleaned] || cleaned;
}

function normalizeLocation(rawLocation) {
  if (!rawLocation) {
    return null;
  }

  return toTitleCase(String(rawLocation).replace(/\s+/g, ' ').trim());
}

function formatHumanDate(rawDate) {
  if (!rawDate) {
    return null;
  }

  const date = new Date(rawDate);

  if (Number.isNaN(date.getTime())) {
    return String(rawDate).trim();
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function formatHumanDateTime(rawDate) {
  if (!rawDate) {
    return null;
  }

  const date = new Date(rawDate);

  if (Number.isNaN(date.getTime())) {
    return String(rawDate).trim();
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function buildReply({ status, lastLocation, expectedDelivery, courierName, lastUpdateAt }) {
  let reply;

  if (status === 'delivered') {
    reply = 'Your order has been delivered.';
  } else if (status === 'out for delivery') {
    reply = 'Your order is out for delivery.';
  } else if (status === 'cancelled') {
    reply = 'This order has been cancelled.';
  } else {
    reply = `Your order is currently ${status}.`;
  }

  if (lastLocation) {
    reply += ` Last update: ${lastLocation}.`;
  }

  if (courierName) {
    reply += ` Courier partner: ${courierName}.`;
  }

  if (expectedDelivery) {
    reply += ` Expected delivery: ${expectedDelivery}.`;
  }

  if (lastUpdateAt) {
    reply += ` Updated: ${lastUpdateAt}.`;
  }

  return reply;
}

module.exports = {
  buildReply,
  formatHumanDate,
  formatHumanDateTime,
  normalizeLocation,
  normalizeStatus,
};
