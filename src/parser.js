const {
  debugLog,
  emitLogEvent,
  readCString,
  readInt16,
  readInt32,
  hexPreview,
} = require("./utils");

class PGStreamParser {
  constructor(sideName, role = "client") {
    this.sideName = sideName;
    this.buffer = Buffer.alloc(0);
    this.expectStartup = role === "client";
    this.expectSSLResponse = role === "server";
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const msgs = [];

    while (true) {
      if (this.expectSSLResponse) {
        if (this.buffer.length < 1) break;
        const ch = String.fromCharCode(this.buffer[0]);
        if (ch === "S" || ch === "N") {
          msgs.push({
            startup: true,
            sslResponse: ch,
            raw: this.buffer.slice(0, 1),
          });
          this.buffer = this.buffer.slice(1);
          this.expectSSLResponse = false;
          continue;
        } else {
          this.expectSSLResponse = false;
        }
      }

      if (this.expectStartup) {
        if (this.buffer.length < 4) break;
        const totalLen = this.buffer.readInt32BE(0);
        // totalLen already includes the 4-byte length field
        if (this.buffer.length < totalLen) break;
        const body = this.buffer.slice(4, 4 + totalLen - 4);
        const code = body.readInt32BE(0);
        const isSSLRequest = code === 80877103;
        const isCancelRequest = code === 80877102;
        const isGSSENCRequest = code === 80877104;
        msgs.push({
          startup: true,
          sslRequest: isSSLRequest,
          cancelRequest: isCancelRequest,
          gssencRequest: isGSSENCRequest,
          totalLen,
          payload: body,
          raw: this.buffer.slice(0, totalLen),
        });
        this.buffer = this.buffer.slice(totalLen);
        if (!isSSLRequest && !isGSSENCRequest) {
          this.expectStartup = false;
        }
        continue;
      } else {
        if (this.buffer.length < 5) break;
        const type = String.fromCharCode(this.buffer[0]);
        const msgLen = this.buffer.readInt32BE(1);
        if (this.buffer.length < 1 + msgLen) break;
        const payload = this.buffer.slice(5, 1 + msgLen);
        const raw = this.buffer.slice(0, 1 + msgLen);
        msgs.push({ startup: false, type, msgLen, payload, raw });
        this.buffer = this.buffer.slice(1 + msgLen);
        continue;
      }
    }

    return msgs;
  }
}

function prettyPrintClientMessage(connId, obj) {
  if (obj.startup) {
    if (obj.sslRequest) {
      debugLog(
        connId,
        `Client -> Server: SSLRequest (len=${obj.totalLen}). Will forward as-is.`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: "SSLRequest",
        data: { len: obj.totalLen },
      });
      return;
    }
    if (obj.gssencRequest) {
      debugLog(
        connId,
        `Client -> Server: GSSENCRequest (len=${obj.totalLen}). Will forward as-is.`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: "GSSENCRequest",
        data: { len: obj.totalLen },
      });
      return;
    }
    if (obj.cancelRequest) {
      debugLog(
        connId,
        `Client -> Server: CancelRequest (len=${obj.totalLen}). Will forward as-is.`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: "CancelRequest",
        data: { len: obj.totalLen },
      });
      return;
    }
    const proto = obj.payload.readInt32BE(0);
    let off = 4;
    const params = {};
    while (off < obj.payload.length) {
      const { str, nextOffset } = readCString(obj.payload, off);
      if (!str) break;
      off = nextOffset;
      const { str: val, nextOffset: next2 } = readCString(obj.payload, off);
      off = next2;
      params[str] = val;
    }
    debugLog(
      connId,
      `Client -> Server: StartupMessage (protocol=${proto}) params=${JSON.stringify(
        params
      )}`
    );
    emitLogEvent({
      level: "client",
      conn: connId,
      text: "StartupMessage",
      data: { protocol: proto, params },
    });
    return;
  }

  const t = obj.type;
  const payload = obj.payload;
  const msgLen = obj.msgLen;

  switch (t) {
    case "Q": {
      const query = payload.toString("utf8", 0, payload.length - 1);
      debugLog(
        connId,
        `Client -> Server: Simple Query (Q) len=${msgLen} sql=${query}`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: `Q: ${query}`,
        data: { len: msgLen },
      });
      break;
    }
    case "P": {
      let off = 0;
      const { str: stmtName, nextOffset } = readCString(payload, off);
      off = nextOffset;
      const { str: query, nextOffset: noff } = readCString(payload, off);
      off = noff;
      const paramCount =
        payload.length >= off + 2 ? readInt16(payload, off) : 0;
      off += 2;
      const paramOids = [];
      for (let i = 0; i < paramCount; i++) {
        paramOids.push(payload.readInt32BE(off));
        off += 4;
      }
      debugLog(
        connId,
        `Client -> Server: Parse (P) stmt='${stmtName}' paramOids=[${paramOids.join(
          ","
        )}] sql=${query}`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: `P: ${stmtName}`,
        data: { sql: query, paramOids },
      });
      break;
    }
    case "B": {
      let off = 0;
      const { str: portal, nextOffset } = readCString(payload, off);
      off = nextOffset;
      const { str: stmtName, nextOffset: n2 } = readCString(payload, off);
      off = n2;
      const paramFormatCount = readInt16(payload, off);
      off += 2;
      const paramFormats = [];
      for (let i = 0; i < paramFormatCount; i++) {
        paramFormats.push(readInt16(payload, off));
        off += 2;
      }
      const paramCount = readInt16(payload, off);
      off += 2;
      const params = [];
      for (let i = 0; i < paramCount; i++) {
        const valLen = payload.readInt32BE(off);
        off += 4;
        if (valLen === -1) {
          params.push(null);
        } else {
          const valBuf = payload.slice(off, off + valLen);
          off += valLen;
          try {
            params.push({ len: valLen, preview: valBuf.toString("utf8") });
          } catch (e) {
            params.push({ len: valLen, preview: hexPreview(valBuf) });
          }
        }
      }
      const resultFormatCount = readInt16(payload, off);
      off += 2;
      const resultFormats = [];
      for (let i = 0; i < resultFormatCount; i++) {
        resultFormats.push(readInt16(payload, off));
        off += 2;
      }
      debugLog(
        connId,
        `Client -> Server: Bind (B) portal='${portal}' stmt='${stmtName}' params=${JSON.stringify(
          params
        )} resultFormats=[${resultFormats}] paramFormats=[${paramFormats}]`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: `B: ${stmtName}`,
        data: { portal, params, resultFormats, paramFormats },
      });
      break;
    }
    case "E": {
      let off = 0;
      const { str: portal, nextOffset } = readCString(payload, off);
      off = nextOffset;
      const maxRows = payload.readInt32BE(off);
      debugLog(
        connId,
        `Client -> Server: Execute (E) portal='${portal}' maxRows=${maxRows}`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: `E: ${portal}`,
        data: { maxRows },
      });
      break;
    }
    case "S": {
      debugLog(connId, `Client -> Server: Sync (S)`);
      emitLogEvent({ level: "client", conn: connId, text: "Sync" });
      break;
    }
    case "X": {
      debugLog(connId, `Client -> Server: Terminate (X)`);
      emitLogEvent({ level: "client", conn: connId, text: "Terminate" });
      break;
    }
    default: {
      debugLog(
        connId,
        `Client -> Server: Type='${t}' len=${msgLen} payload=${hexPreview(
          payload,
          64
        )}`
      );
      emitLogEvent({
        level: "client",
        conn: connId,
        text: `Type=${t}`,
        data: { len: msgLen },
      });
    }
  }
}

function prettyPrintServerMessage(connId, obj) {
  if (obj.startup) {
    if (obj.sslResponse) {
      const accepted = obj.sslResponse === "S";
      debugLog(
        connId,
        `Server -> Client: SSLResponse '${obj.sslResponse}' (${
          accepted ? "accept TLS" : "deny TLS"
        })`
      );
      return;
    }
    debugLog(
      connId,
      `Server -> Client: (unexpected startup) raw=${hexPreview(obj.payload)}`
    );
    return;
  }

  const t = obj.type;
  const payload = obj.payload;
  const msgLen = obj.msgLen;

  switch (t) {
    case "R": {
      const code = payload.readInt32BE(0);
      const desc =
        code === 0
          ? "AuthenticationOk"
          : code === 5
          ? "MD5Password"
          : code === 10
          ? "SASL"
          : code === 8
          ? "GSS"
          : `code=${code}`;
      if (code === 5) {
        const salt = payload.slice(4, 8);
        debugLog(
          connId,
          `Server -> Client: Authentication (R) MD5Password salt=${salt.toString(
            "hex"
          )}`
        );
        emitLogEvent({
          level: "server",
          conn: connId,
          text: "Authentication: MD5Password",
          data: { salt: salt.toString("hex") },
        });
      } else {
        debugLog(connId, `Server -> Client: Authentication (R) ${desc}`);
        emitLogEvent({
          level: "server",
          conn: connId,
          text: `Authentication: ${desc}`,
        });
      }
      break;
    }
    case "T": {
      let off = 0;
      const fieldCount = readInt16(payload, off);
      off += 2;
      const fields = [];
      for (let i = 0; i < fieldCount; i++) {
        const { str: name, nextOffset } = readCString(payload, off);
        off = nextOffset;
        const tableOID = payload.readInt32BE(off);
        off += 4;
        const colAttr = readInt16(payload, off);
        off += 2;
        const dataType = payload.readInt32BE(off);
        off += 4;
        const dataSize = readInt16(payload, off);
        off += 2;
        const typeModifier = payload.readInt32BE(off);
        off += 4;
        const format = readInt16(payload, off);
        off += 2;
        fields.push({
          name,
          tableOID,
          colAttr,
          dataType,
          dataSize,
          typeModifier,
          format,
        });
      }
      debugLog(
        connId,
        `Server -> Client: RowDescription (T) fields=${JSON.stringify(fields)}`
      );
      emitLogEvent({
        level: "server",
        conn: connId,
        text: "RowDescription",
        data: { fields },
      });
      break;
    }
    case "D": {
      let off = 0;
      const colCount = readInt16(payload, off);
      off += 2;
      const cols = [];
      for (let i = 0; i < colCount; i++) {
        const len = payload.readInt32BE(off);
        off += 4;
        if (len === -1) {
          cols.push(null);
        } else {
          const valBuf = payload.slice(off, off + len);
          off += len;
          try {
            cols.push(valBuf.toString("utf8"));
          } catch (e) {
            cols.push(hexPreview(valBuf));
          }
        }
      }
      debugLog(
        connId,
        `Server -> Client: DataRow (D) cols=${JSON.stringify(cols)}`
      );
      emitLogEvent({
        level: "server",
        conn: connId,
        text: "DataRow",
        data: { cols },
      });
      break;
    }
    case "C": {
      const tag = payload.toString("utf8", 0, payload.length - 1);
      debugLog(connId, `Server -> Client: CommandComplete (C) tag='${tag}'`);
      emitLogEvent({
        level: "server",
        conn: connId,
        text: `CommandComplete: ${tag}`,
      });
      break;
    }
    case "E": {
      let off = 0;
      const fields = {};
      while (off < payload.length) {
        const fieldType = payload[off++];
        if (fieldType === 0) break;
        const { str, nextOffset } = readCString(payload, off);
        off = nextOffset;
        fields[String.fromCharCode(fieldType)] = str;
      }
      debugLog(
        connId,
        `Server -> Client: ErrorResponse (E) ${JSON.stringify(fields)}`
      );
      emitLogEvent({
        level: "error",
        conn: connId,
        text: "ErrorResponse",
        data: fields,
      });
      break;
    }
    case "Z": {
      const status = payload.toString("utf8", 0, payload.length);
      debugLog(
        connId,
        `Server -> Client: ReadyForQuery (Z) status='${status}'`
      );
      emitLogEvent({
        level: "server",
        conn: connId,
        text: `ReadyForQuery: ${status}`,
      });
      break;
    }
    case "N": {
      const msg = payload.toString("utf8", 0, payload.length - 1);
      debugLog(connId, `Server -> Client: Notice (N) ${msg}`);
      emitLogEvent({ level: "server", conn: connId, text: `Notice: ${msg}` });
      break;
    }
    default: {
      debugLog(
        connId,
        `Server -> Client: Type='${t}' len=${msgLen} payload=${hexPreview(
          payload,
          64
        )}`
      );
      emitLogEvent({
        level: "server",
        conn: connId,
        text: `Type=${t}`,
        data: { len: msgLen },
      });
    }
  }
}

module.exports = {
  PGStreamParser,
  prettyPrintClientMessage,
  prettyPrintServerMessage,
};
