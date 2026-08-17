/**
 * 极简 S3 兼容客户端：纯前端 SigV4 签名，零依赖。
 *
 * 覆盖 BYOC 需要的五个操作：PUT / GET / HEAD / DELETE / ListObjectsV2。
 * 兼容腾讯云 COS、阿里云 OSS（S3 兼容接口）、Cloudflare R2、Backblaze B2、
 * MinIO 与通用 AWS S3——它们都实现 AWS Signature V4。
 *
 * 安全模型（直连模式）：AccessKey/SecretKey 只存在于用户浏览器本地，
 * 每次请求现场签名，密钥不出设备；会话走 HTTPS，桶必须设为私有。
 * 代价是需要用户在存储控制台为桶配置 CORS（允许本应用域名 + 这些方法），
 * 否则浏览器会拦截响应——这是纯前端方案的固有前提。
 */
import type { ByocConfig } from './types';
import { sha256Hex as jsSha256Hex, hmacSha256 as jsHmacSha256 } from '../../utils/sha256';

/**
 * 浏览器在非安全上下文（http:// 局域网 IP 等）没有 crypto.subtle，
 * 此时降级为纯 JS 的 SHA-256/HMAC 实现（结果与 WebCrypto 完全一致）。
 * 每次调用动态检测（便于测试模拟禁用），开销可忽略。
 */
function hasSubtle(): boolean {
  return typeof globalThis.crypto !== 'undefined' && !!globalThis.crypto.subtle;
}

export interface S3ObjectInfo {
  key: string;
  size: number;
  lastModified: number;
}

/** 供调用方构造请求的内部参数（signRequest 的入参，测试脚本也会用到） */
export interface S3ClientOptions {
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  accessKey: string;
  secretKey: string;
}

/** 供错误提示识别"网络层失败"（CORS 拦截、域名解析失败等） */
export class S3NetworkError extends Error {}

/**
 * AWS 规定的 canonical URI 编码：unreserved 之外全部 %XX（大写），
 * 但斜杠 / 不编码（encodeURIComponent 会把 / 编成 %2F，必须还原）。
 */
function awsUriEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2F/gi, '/');
}

/**
 * canonical query 编码：AWS UriEncode 标准规则，斜杠也要编码为 %2F。
 * 与 URI 不同——腾讯云 COS 严格按此验签，若 query 值里的斜杠保留原样
 * （如 prefix=PortAI/），会报 SignatureDoesNotMatch（已实测定位）。
 */
function awsQueryEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function hmac(key: string | ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyData = toBytes(key);
  const msg = new TextEncoder().encode(data);
  if (!hasSubtle()) return jsHmacSha256(keyData, msg).buffer as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, msg);
}

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = toBytes(data);
  if (!hasSubtle()) return jsSha256Hex(buf);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(digest);
}

/** 统一字节输入：string 走 UTF-8，ArrayBuffer/Uint8Array 拷贝为 ArrayBuffer 背书（满足 BufferSource 类型） */
function toBytes(data: string | ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(data);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 构造签名后的请求（导出供签名向量测试/调试用，应用侧勿直接调用）。
 *
 * PUT 需要真实的 payload hash（服务端校验内容完整性）；其余操作按 S3 惯例
 * 用空串 hash，即 x-amz-content-sha256 与正文无关。
 * now 参数仅用于测试注入固定时间。
 */
export async function signRequest(
  opts: S3ClientOptions,
  method: string,
  url: URL,
  query: Record<string, string>,
  payloadHash: string,
  now: Date = new Date()
): Promise<HeadersInit> {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = awsUriEncode(url.pathname);
  const canonicalQuery = Object.keys(query)
    .sort()
    .map(k => `${awsQueryEncode(k)}=${awsQueryEncode(query[k])}`)
    .join('&');

  const host = url.host;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest =
    `${method}\n${canonicalUri}\n${canonicalQuery}\n` +
    `${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;

  const kDate = await hmac(`AWS4${opts.secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, opts.region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  return {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
}

/** endpoint 规范化：允许用户填 http(s):// 前缀（本地 MinIO 常见），否则补 https */
function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** 按 path-style / virtual-hosted 两种模式构造对象 URL */
function objectUrl(opts: S3ClientOptions, key: string): URL {
  const base = normalizeEndpoint(opts.endpoint);
  if (opts.pathStyle) {
    return new URL(`${base}/${opts.bucket}/${key}`);
  }
  // virtual-hosted：bucket 作为子域名，host 头随之变化（签名用 url.host）
  const protocol = base.startsWith('https://') ? 'https://' : 'http://';
  const host = `${opts.bucket}.${base.replace(/^https?:\/\//i, '')}`;
  return new URL(`${protocol}${host}/${key}`);
}

/** 统一网络层错误信息：直连模式 90% 的失败是 CORS 或网络，给出可操作的提示 */
function networkError(): Error {
  const message =
    '无法连接云存储，请检查：Endpoint 是否正确、网络是否可达，' +
    '以及桶的 CORS 是否允许本应用域名（需开放 GET/PUT/HEAD/DELETE）';
  return new S3NetworkError(message);
}

export function createS3Client(cfg: ByocConfig) {
  const opts: S3ClientOptions = {
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    pathStyle: cfg.pathStyle,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
  };

  const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  async function request(
    method: string,
    key: string,
    query: Record<string, string> = {},
    body?: Blob
  ): Promise<Response> {
    const url = objectUrl(opts, key);
    if (Object.keys(query).length) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const payloadHash =
      method === 'PUT' && body
        ? await sha256Hex(await body.arrayBuffer())
        : EMPTY_HASH;

    const headers = await signRequest(opts, method, url, query, payloadHash);
    if (body) (headers as Record<string, string>)['Content-Type'] = body.type || 'application/octet-stream';

    let res: Response;
    try {
      // 请求超时保护：网络挂起时同步流程会一直占着 syncing 锁，
      // 后续所有自动/手动同步都会静默失败，表现为"不再同步"。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        res = await fetch(url, { method, headers, body, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      throw networkError();
    }
    if (res.status === 404 && method !== 'PUT') return res; // 让调用方按需处理 404
    if (!res.ok) {
      const statusText = await res.text().catch(() => '');
      const detail = statusText.slice(0, 200);
      if (res.status === 401 || res.status === 403) {
        // 提取 S3/COS 返回的具体错误码（如 SignatureDoesNotMatch / InvalidAccessKeyId），
        // 透传给用户以精确定位原因，而不是只给一句笼统文案。
        const codeMatch = /<Code>([^<]+)<\/Code>/.exec(statusText);
        const msgMatch = /<Message>([^<]+)<\/Message>/.exec(statusText);
        const code2 = codeMatch?.[1] ?? '';
        const msg2 = msgMatch?.[1] ?? '';
        const suffix = code2 ? `（${code2}${msg2 ? `: ${msg2}` : ''}）` : '';
        throw new Error(`云存储拒绝访问（${res.status}）：AccessKey/SecretKey 无效或桶权限不足${suffix}`);
      }
      throw new Error(`云存储请求失败（${res.status}）${detail ? `：${detail}` : ''}`);
    }
    return res;
  }

  return {
    /** 上传对象。同 key 覆盖写，Content-Type 取 blob 自带类型。 */
    async putObject(key: string, blob: Blob): Promise<void> {
      await request('PUT', key, {}, blob);
    },

    /** 读取对象；不存在返回 null（S3 的 GET 404） */
    async getObject(key: string): Promise<Blob | null> {
      const res = await request('GET', key);
      if (res.status === 404) return null;
      return res.blob();
    },

    /** 是否存在（探测用，避免每张图都整包下载） */
    async headObject(key: string): Promise<boolean> {
      const res = await request('HEAD', key);
      return res.status !== 404;
    },

    async deleteObject(key: string): Promise<void> {
      await request('DELETE', key);
    },

    /**
     * 列对象（自动翻页）。只返回 key/size/lastModified。
     * 响应是 XML，用 DOMParser 解析；IsTruncated 为 true 时继续翻页。
     */
    async listObjects(prefix: string): Promise<S3ObjectInfo[]> {
      const out: S3ObjectInfo[] = [];
      let token: string | undefined;
      for (;;) {
        const query: Record<string, string> = {
          'list-type': '2',
          prefix,
          'max-keys': '1000',
        };
        if (token) query['continuation-token'] = token;

        const res = await request('GET', '', query);
        if (res.status === 404) return out; // 桶里还没有对象
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');

        for (const c of Array.from(xml.getElementsByTagName('Contents'))) {
          const key = c.getElementsByTagName('Key')[0]?.textContent ?? '';
          const size = Number(c.getElementsByTagName('Size')[0]?.textContent ?? 0);
          const lm = c.getElementsByTagName('LastModified')[0]?.textContent;
          out.push({ key, size, lastModified: lm ? Date.parse(lm) : 0 });
        }

        const truncated = xml.getElementsByTagName('IsTruncated')[0]?.textContent;
        if (truncated !== 'true') break;
        token =
          xml.getElementsByTagName('NextContinuationToken')[0]?.textContent ?? undefined;
        if (!token) break;
      }
      return out;
    },
  };
}

export type S3Client = ReturnType<typeof createS3Client>;
