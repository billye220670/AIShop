// src/utils/sha256.ts
function toBytes(data) {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var H0 = new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
function sha256Raw(msg) {
  const h = new Uint32Array(H0);
  const bitLenHi = Math.floor(msg.length / 536870912);
  const bitLenLo = msg.length % 536870912 * 8;
  const total = Math.floor((msg.length + 8) / 64) * 64 + 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 128;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLenHi);
  dv.setUint32(total - 4, bitLenLo);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = hh + s1 + ch + K[i] + w[i] >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = s0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, h[i]);
  return out;
}
function sha256Hex(data) {
  const digest = sha256Raw(toBytes(data));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hmacSha256(key, data) {
  let k = toBytes(key);
  if (k.length > 64) k = sha256Raw(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = (k[i] ?? 0) ^ 54;
    opad[i] = (k[i] ?? 0) ^ 92;
  }
  return sha256Raw(concatBytes(opad, sha256Raw(concatBytes(ipad, toBytes(data)))));
}

// src/services/byoc/s3Client.ts
function hasSubtle() {
  return typeof globalThis.crypto !== "undefined" && !!globalThis.crypto.subtle;
}
var S3NetworkError = class extends Error {
};
function awsUriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/gi, "/");
}
function awsQueryEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
async function hmac(key, data) {
  const keyData = toBytes2(key);
  const msg = new TextEncoder().encode(data);
  if (!hasSubtle()) return hmacSha256(keyData, msg).buffer;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, msg);
}
async function sha256Hex2(data) {
  const buf = toBytes2(data);
  if (!hasSubtle()) return sha256Hex(buf);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return toHex(digest);
}
function toBytes2(data) {
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array(data);
}
function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signRequest(opts, method, url, query, payloadHash, now = /* @__PURE__ */ new Date()) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = awsUriEncode(url.pathname);
  const canonicalQuery = Object.keys(query).sort().map((k) => `${awsQueryEncode(k)}=${awsQueryEncode(query[k])}`).join("&");
  const host = url.host;
  const canonicalHeaders = `host:${host}
x-amz-content-sha256:${payloadHash}
x-amz-date:${amzDate}
`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `${method}
${canonicalUri}
${canonicalQuery}
${canonicalHeaders}
${signedHeaders}
${payloadHash}`;
  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256
${amzDate}
${scope}
${await sha256Hex2(canonicalRequest)}`;
  const kDate = await hmac(`AWS4${opts.secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, opts.region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));
  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash
  };
}
function normalizeEndpoint(endpoint) {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
function objectUrl(opts, key) {
  const base = normalizeEndpoint(opts.endpoint);
  if (opts.pathStyle) {
    return new URL(`${base}/${opts.bucket}/${key}`);
  }
  const protocol = base.startsWith("https://") ? "https://" : "http://";
  const host = `${opts.bucket}.${base.replace(/^https?:\/\//i, "")}`;
  return new URL(`${protocol}${host}/${key}`);
}
function networkError() {
  const message = "\u65E0\u6CD5\u8FDE\u63A5\u4E91\u5B58\u50A8\uFF0C\u8BF7\u68C0\u67E5\uFF1AEndpoint \u662F\u5426\u6B63\u786E\u3001\u7F51\u7EDC\u662F\u5426\u53EF\u8FBE\uFF0C\u4EE5\u53CA\u6876\u7684 CORS \u662F\u5426\u5141\u8BB8\u672C\u5E94\u7528\u57DF\u540D\uFF08\u9700\u5F00\u653E GET/PUT/HEAD/DELETE\uFF09";
  return new S3NetworkError(message);
}
function createS3Client(cfg) {
  const opts = {
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    pathStyle: cfg.pathStyle,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey
  };
  const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  async function request(method, key, query = {}, body) {
    const url = objectUrl(opts, key);
    if (Object.keys(query).length) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const payloadHash = method === "PUT" && body ? await sha256Hex2(await body.arrayBuffer()) : EMPTY_HASH;
    const headers = await signRequest(opts, method, url, query, payloadHash);
    if (body) headers["Content-Type"] = body.type || "application/octet-stream";
    let res;
    try {
      res = await fetch(url, { method, headers, body });
    } catch {
      throw networkError();
    }
    if (res.status === 404 && method !== "PUT") return res;
    if (!res.ok) {
      const statusText = await res.text().catch(() => "");
      const detail = statusText.slice(0, 200);
      if (res.status === 401 || res.status === 403) {
        const codeMatch = /<Code>([^<]+)<\/Code>/.exec(statusText);
        const msgMatch = /<Message>([^<]+)<\/Message>/.exec(statusText);
        const code2 = codeMatch?.[1] ?? "";
        const msg2 = msgMatch?.[1] ?? "";
        const suffix = code2 ? `\uFF08${code2}${msg2 ? `: ${msg2}` : ""}\uFF09` : "";
        throw new Error(`\u4E91\u5B58\u50A8\u62D2\u7EDD\u8BBF\u95EE\uFF08${res.status}\uFF09\uFF1AAccessKey/SecretKey \u65E0\u6548\u6216\u6876\u6743\u9650\u4E0D\u8DB3${suffix}`);
      }
      throw new Error(`\u4E91\u5B58\u50A8\u8BF7\u6C42\u5931\u8D25\uFF08${res.status}\uFF09${detail ? `\uFF1A${detail}` : ""}`);
    }
    return res;
  }
  return {
    /** 上传对象。同 key 覆盖写，Content-Type 取 blob 自带类型。 */
    async putObject(key, blob) {
      await request("PUT", key, {}, blob);
    },
    /** 读取对象；不存在返回 null（S3 的 GET 404） */
    async getObject(key) {
      const res = await request("GET", key);
      if (res.status === 404) return null;
      return res.blob();
    },
    /** 是否存在（探测用，避免每张图都整包下载） */
    async headObject(key) {
      const res = await request("HEAD", key);
      return res.status !== 404;
    },
    async deleteObject(key) {
      await request("DELETE", key);
    },
    /**
     * 列对象（自动翻页）。只返回 key/size/lastModified。
     * 响应是 XML，用 DOMParser 解析；IsTruncated 为 true 时继续翻页。
     */
    async listObjects(prefix) {
      const out = [];
      let token;
      for (; ; ) {
        const query = {
          "list-type": "2",
          prefix,
          "max-keys": "1000"
        };
        if (token) query["continuation-token"] = token;
        const res = await request("GET", "", query);
        if (res.status === 404) return out;
        const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
        for (const c of Array.from(xml.getElementsByTagName("Contents"))) {
          const key = c.getElementsByTagName("Key")[0]?.textContent ?? "";
          const size = Number(c.getElementsByTagName("Size")[0]?.textContent ?? 0);
          const lm = c.getElementsByTagName("LastModified")[0]?.textContent;
          out.push({ key, size, lastModified: lm ? Date.parse(lm) : 0 });
        }
        const truncated = xml.getElementsByTagName("IsTruncated")[0]?.textContent;
        if (truncated !== "true") break;
        token = xml.getElementsByTagName("NextContinuationToken")[0]?.textContent ?? void 0;
        if (!token) break;
      }
      return out;
    }
  };
}
export {
  S3NetworkError,
  createS3Client,
  signRequest
};
