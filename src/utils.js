// Utility helpers shared across the proxy

function debugLog(prefix, ...args) {
  const time = new Date().toISOString();
  console.log(`[${time}] [${prefix}]`, ...args);
}

/** Helper: read C-string (null-terminated) from buffer starting at offset. Returns { str, nextOffset }. */
function readCString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.toString("utf8", offset, end);
  return { str, nextOffset: end + 1 };
}

/** Helper: read Int16BE */
function readInt16(buf, offset) {
  return buf.readUInt16BE(offset);
}

/** Helper: read Int32BE */
function readInt32(buf, offset) {
  return buf.readInt32BE(offset);
}

/** Convert buffer to hex preview */
function hexPreview(buf, max = 32) {
  const slice = buf.slice(0, max);
  return slice.toString("hex") + (buf.length > max ? "..." : "");
}

module.exports = {
  debugLog,
  readCString,
  readInt16,
  readInt32,
  hexPreview,
};
