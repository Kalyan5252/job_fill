function ts() {
  return new Date().toISOString();
}

function info(message, meta) {
  if (meta) {
    console.log(`[${ts()}] INFO: ${message}`, meta);
    return;
  }
  console.log(`[${ts()}] INFO: ${message}`);
}

function warn(message, meta) {
  if (meta) {
    console.warn(`[${ts()}] WARN: ${message}`, meta);
    return;
  }
  console.warn(`[${ts()}] WARN: ${message}`);
}

function error(message, meta) {
  if (meta) {
    console.error(`[${ts()}] ERROR: ${message}`, meta);
    return;
  }
  console.error(`[${ts()}] ERROR: ${message}`);
}

module.exports = { info, warn, error };
