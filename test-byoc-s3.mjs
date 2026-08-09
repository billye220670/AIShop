/**
 * SigV4 签名算法验证脚本（对照 AWS 官方测试向量）。
 *
 * 用法：npx esbuild src/services/byoc/s3Client.ts --bundle --format=esm --outfile=test-s3-bundle.mjs
 *       node test-byoc-s3.mjs
 *
 * 向量来源：AWS Signature V4 test suite 的经典 GET 示例
 * （examplebucket / test.txt，详见 AWS 文档 signature-v4-test-suite），
 * 加一条带斜杠 query 参数的用例（prefix=aishop/）——腾讯云 COS 严格按
 * UriEncode 验签，query 值里的斜杠必须编码为 %2F，此用例锁定该行为。
 * 期望值已经 npm 库 aws4（AWS SDK 同款参考实现）交叉验证：
 *   node tmp-aws4-query.mjs → Signature=32ad6aa0c5398a59cfb76898460e1cd204967e56ce883c6a64a7ee5f2e61b6c1
 * 签名正确时打印 PASS，否则打印期望值与实际值。
 */
import { signRequest } from './test-s3-bundle.mjs';

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const opts = {
  endpoint: 'examplebucket.s3.amazonaws.com',
  region: 'us-east-1',
  bucket: 'examplebucket',
  pathStyle: false,
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

// 期望值（经 aws4 交叉验证）：GET /test.txt，时间为 2013-05-24T00:00:00Z
const expected =
  'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
  'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
  'Signature=14f6a0997b2b70a86f4726658a6575b5109092ccb5fd328f51b369c44b4ac958';

const url = new URL('https://examplebucket.s3.amazonaws.com/test.txt');
const headers = await signRequest(opts, 'GET', url, {}, EMPTY_HASH, new Date('2013-05-24T00:00:00.000Z'));

const actual = String(headers['Authorization']);
if (actual === expected) {
  console.log('PASS: SigV4 签名与 AWS 官方向量一致');
} else {
  console.log('FAIL: 签名不匹配');
  console.log('期望:', expected);
  console.log('实际:', actual);
  process.exit(1);
}

// 用例 2：带斜杠 query（list-type=2&prefix=aishop/&max-keys=1000），期望值经 aws4 交叉验证
const expectedQuery =
  'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
  'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
  'Signature=32ad6aa0c5398a59cfb76898460e1cd204967e56ce883c6a64a7ee5f2e61b6c1';

const url2 = new URL('https://examplebucket.s3.amazonaws.com/');
const query = { 'list-type': '2', prefix: 'aishop/', 'max-keys': '1000' };
const headers2 = await signRequest(opts, 'GET', url2, query, EMPTY_HASH, new Date('2013-05-24T00:00:00.000Z'));

const actual2 = String(headers2['Authorization']);
if (actual2 === expectedQuery) {
  console.log('PASS: 带斜杠 query 签名与 aws4 一致');
} else {
  console.log('FAIL: 带斜杠 query 签名不匹配');
  console.log('期望:', expectedQuery);
  console.log('实际:', actual2);
  process.exit(1);
}

// 用例 3：模拟非安全上下文（无 crypto.subtle，如 http:// 局域网访问），
// 验证纯 JS SHA-256/HMAC 降级实现的签名与 WebCrypto 路径完全一致
const subtleDesc = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
let headers3;
try {
  headers3 = await signRequest(opts, 'GET', url, {}, EMPTY_HASH, new Date('2013-05-24T00:00:00.000Z'));
} finally {
  if (subtleDesc) Object.defineProperty(globalThis.crypto, 'subtle', subtleDesc);
}
const actual3 = String(headers3['Authorization']);
if (actual3 === expected) {
  console.log('PASS: 无 WebCrypto（JS 降级）签名与官方向量一致');
} else {
  console.log('FAIL: JS 降级签名不匹配');
  console.log('期望:', expected);
  console.log('实际:', actual3);
  process.exit(1);
}
