function write(level, message, metadata) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
  }

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

module.exports = {
  info(message, metadata = {}) {
    write('info', message, metadata);
  },
  warn(message, metadata = {}) {
    write('warn', message, metadata);
  },
  error(message, metadata = {}) {
    write('error', message, metadata);
  },
  stream: {
    write(message) {
      write('http', message.trim());
    },
  },
};
