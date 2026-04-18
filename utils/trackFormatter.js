function toTitleCase(value) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function normalizeStatus(rawStatus) {
  if (!rawStatus) {
    return 'being processed';
  }

  const cleaned = String(rawStatus).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  if (cleaned.includes('pick up scan') || cleaned.includes('pickup scan')) {
    return 'picked up';
  }

  if (cleaned.includes('p/u shipment') || cleaned.includes('out to p/u') || cleaned.includes('out to pickup')) {
    return 'pickup scheduled';
  }

  if (cleaned.includes('out for delivery') || cleaned === 'ofd') {
    return 'out for delivery';
  }

  if (cleaned.includes('return delivered') || cleaned.includes('rto delivered')) {
    return 'return delivered';
  }

  if (cleaned.includes('return in transit') || cleaned.includes('rto in transit')) {
    return 'return in transit';
  }

  if (cleaned.includes('delivered')) {
    return 'delivered';
  }

  if (
    cleaned.includes('outscan') ||
    cleaned.includes('inscan') ||
    cleaned.includes('outscanned to network') ||
    cleaned.includes('bagged') ||
    cleaned.includes('received at') ||
    cleaned.includes('reached at') ||
    cleaned.includes('arrived at') ||
    cleaned.includes('hub') ||
    cleaned.includes('network')
  ) {
    return 'in transit';
  }

  if (cleaned.includes('manifest')) {
    return 'manifest generated';
  }

  if (cleaned.includes('shipment booked')) {
    return 'shipment booked';
  }

  if (cleaned.includes('pickup scheduled')) {
    return 'pickup scheduled';
  }

  if (cleaned.includes('cancel')) {
    return 'cancelled';
  }

  if (cleaned.includes('transit')) {
    return 'in transit';
  }

  const statusMap = {
    ofd: 'out for delivery',
    delivered: 'delivered',
    'pickup scheduled': 'pickup scheduled',
    'picked up': 'picked up',
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

function getStatusExplanation(status) {
  const normalized = String(status || '').trim().toLowerCase();
  const explanationMap = {
    'shipment booked': 'The shipment has been created in the courier system.',
    'manifest generated': 'Shipping paperwork has been generated for the parcel.',
    'pickup scheduled': 'Pickup has been scheduled with the courier.',
    'picked up': 'The courier has collected your parcel from the seller.',
    'in transit': 'The parcel is moving through the courier network.',
    'out for delivery': 'The parcel should reach the delivery address soon.',
    delivered: 'The shipment has reached the customer.',
    cancelled: 'The shipment has been cancelled in the system.',
    'return in transit': 'The parcel is moving back to the origin address.',
    'return delivered': 'The returned parcel has reached the origin address.',
  };

  return explanationMap[normalized] || null;
}

function buildReply({ status, lastLocation, expectedDelivery, courierName, lastUpdateAt }) {
  let reply;
  const statusExplanation = getStatusExplanation(status);

  if (status === 'delivered') {
    reply = 'Your order has been delivered.';
  } else if (status === 'out for delivery') {
    reply = 'Your order is out for delivery.';
  } else if (status === 'cancelled') {
    reply = 'This order has been cancelled.';
  } else if (status === 'in transit') {
    reply = 'Your order is in transit.';
  } else {
    reply = `Your order is currently ${status}.`;
  }

  if (statusExplanation) {
    reply += ` ${statusExplanation}`;
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
  getStatusExplanation,
  normalizeLocation,
  normalizeStatus,
};
