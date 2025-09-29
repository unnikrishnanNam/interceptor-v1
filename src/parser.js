const {
  debugLog,
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
        if (this.buffer.length < totalLen + 4) break;
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
          raw: this.buffer.slice(0, 4 + (totalLen - 4)),
        });
        this.buffer = this.buffer.slice(4 + (totalLen - 4));
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
      return;
    }
    if (obj.gssencRequest) {
      debugLog(
        connId,
        `Client -> Server: GSSENCRequest (len=${obj.totalLen}). Will forward as-is.`
      );
      return;
    }
    if (obj.cancelRequest) {
      debugLog(
        connId,
        `Client -> Server: CancelRequest (len=${obj.totalLen}). Will forward as-is.`
      );
      return;
    }
    const proto = obj.payload.readInt32BE(0);
    let off = 4;
    const params = {};
    while (off < obj.payload.length) {
      const { str, nextOffset } = readCString(obj.payload, off);
      off = nextOffset;
      if (str.length === 0) break;
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
    return;
  }

  const t = obj.type;
  switch (t) {
    case "Q": {
      const query = obj.payload.toString("utf8", 0, obj.payload.length - 1);
      debugLog(
        connId,
        `Client -> Server: Simple Query (Q) len=${obj.msgLen} sql=${query}`
      );
      break;
    }
    case "P": {
      let off = 0;
      const { str: stmtName, nextOffset } = readCString(obj.payload, off);
      off = nextOffset;
      const { str: query, nextOffset: noff } = readCString(obj.payload, off);
      off = noff;
      const paramCount =
        obj.payload.length >= off + 2 ? readInt16(obj.payload, off) : 0;
      off += 2;
      const paramOids = [];
      for (let i = 0; i < paramCount; i++) {
        const oid = obj.payload.readInt32BE(off);
        off += 4;
        paramOids.push(oid);
      }
      debugLog(
        connId,
        `Client -> Server: Parse (P) stmt='${stmtName}' paramOids=[${paramOids.join(
          ","
        )}] sql=${query}`
      );
      break;
    }
    case "B": {
      let off = 0;
      const { str: portal, nextOffset } = readCString(obj.payload, off);
      off = nextOffset;
      const { str: stmtName, nextOffset: n2 } = readCString(obj.payload, off);
      off = n2;
      const paramFormatCount = readInt16(obj.payload, off);
      off += 2;
      const paramFormats = [];
      for (let i = 0; i < paramFormatCount; i++) {
        paramFormats.push(readInt16(obj.payload, off));
        off += 2;
      }
      const paramCount = readInt16(obj.payload, off);
      off += 2;
      const params = [];
      for (let i = 0; i < paramCount; i++) {
        const valLen = obj.payload.readInt32BE(off);
        off += 4;
        if (valLen === -1) {
          params.push(null);
        } else {
          const valBuf = obj.payload.slice(off, off + valLen);
          off += valLen;
          const asUtf = (() => {
            try {
              return valBuf.toString("utf8");
            } catch (e) {
              return null;
            }
          })();
          params.push({ len: valLen, preview: asUtf || hexPreview(valBuf) });
        }
      }
      const resultFormatCount = readInt16(obj.payload, off);
      off += 2;
      const resultFormats = [];
      for (let i = 0; i < resultFormatCount; i++) {
        resultFormats.push(readInt16(obj.payload, off));
        off += 2;
      }
      debugLog(
        connId,
        `Client -> Server: Bind (B) portal='${portal}' stmt='${stmtName}' params=${JSON.stringify(
          params
        )} resultFormats=[${resultFormats}] paramFormats=[${paramFormats}]`
      );
      break;
    }
    case "E": {
      let off = 0;
      const { str: portal, nextOffset } = readCString(obj.payload, off);
      off = nextOffset;
      const maxRows = obj.payload.readInt32BE(off);
      debugLog(
        connId,
        `Client -> Server: Execute (E) portal='${portal}' maxRows=${maxRows}`
      );
      break;
    }
    case "S": {
      debugLog(connId, `Client -> Server: Sync (S)`);
      break;
    }
    case "X": {
      debugLog(connId, `Client -> Server: Terminate (X)`);
      break;
    }
    default: {
      debugLog(
        connId,
        `Client -> Server: Type='${t}' len=${obj.msgLen} payload=${hexPreview(
          obj.payload,
          64
        )}`
      );
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
  switch (t) {
    case "R": {
      const code = obj.payload.readInt32BE(0);
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
        const salt = obj.payload.slice(4, 8);
        debugLog(
          connId,
          `Server -> Client: Authentication (R) MD5Password salt=${salt.toString(
            "hex"
          )}`
        );
      } else {
        debugLog(connId, `Server -> Client: Authentication (R) ${desc}`);
      }
      break;
    }
    case "T": {
      let off = 0;
      const fieldCount = readInt16(obj.payload, off);
      off += 2;
      const fields = [];
      for (let i = 0; i < fieldCount; i++) {
        const { str: name, nextOffset } = readCString(obj.payload, off);
        off = nextOffset;
        const tableOID = obj.payload.readInt32BE(off);
        off += 4;
        const colAttr = readInt16(obj.payload, off);
        off += 2;
        const dataType = obj.payload.readInt32BE(off);
        off += 4;
        const dataSize = readInt16(obj.payload, off);
        off += 2;
        const typeModifier = obj.payload.readInt32BE(off);
        off += 4;
        const format = readInt16(obj.payload, off);
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
      break;
    }
    case "D": {
      let off = 0;
      const colCount = readInt16(obj.payload, off);
      off += 2;
      const cols = [];
      for (let i = 0; i < colCount; i++) {
        const len = obj.payload.readInt32BE(off);
        off += 4;
        if (len === -1) {
          cols.push(null);
        } else {
          const valBuf = obj.payload.slice(off, off + len);
          off += len;
          const asUtf = (() => {
            try {
              return valBuf.toString("utf8");
            } catch (e) {
              return null;
            }
          })();
          cols.push(asUtf !== null ? asUtf : hexPreview(valBuf));
        }
      }
      debugLog(
        connId,
        `Server -> Client: DataRow (D) cols=${JSON.stringify(cols)}`
      );
      break;
    }
    case "C": {
      const tag = obj.payload.toString("utf8", 0, obj.payload.length - 1);
      debugLog(connId, `Server -> Client: CommandComplete (C) tag='${tag}'`);
      break;
    }
    case "E": {
      let off = 0;
      const fields = {};
      while (off < obj.payload.length) {
        const fieldType = obj.payload[off];
        off++;
        if (fieldType === 0) break;
        const { str, nextOffset } = readCString(obj.payload, off);
        off = nextOffset;
        fields[String.fromCharCode(fieldType)] = str;
      }
      debugLog(
        connId,
        `Server -> Client: ErrorResponse (E) ${JSON.stringify(fields)}`
      );
      break;
    }
    case "Z": {
      const status = obj.payload.toString("utf8", 0, obj.payload.length);
      debugLog(
        connId,
        `Server -> Client: ReadyForQuery (Z) status='${status}'`
      );
      break;
    }
    case "N": {
      const msg = obj.payload.toString("utf8", 0, obj.payload.length - 1);
      debugLog(connId, `Server -> Client: Notice (N) ${msg}`);
      break;
    }
    default: {
      debugLog(
        connId,
        `Server -> Client: Type='${t}' len=${obj.msgLen} payload=${hexPreview(
          obj.payload,
          64
        )}`
      );
    }
  }
}

module.exports = {
  PGStreamParser,
  prettyPrintClientMessage,
  prettyPrintServerMessage,
};
