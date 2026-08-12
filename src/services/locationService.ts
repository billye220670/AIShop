/**
 * 用户所在城市获取服务。
 *
 * 用途：把用户城市注入系统提示词与搜索判断，让"今天天气如何"这类本地
 * 实时问题被精准回答（搜索词自动带城市，而不是返回全国通用结果）。
 *
 * 获取链路（按优先级）：
 * 1. 手动设置：设置页填写，存 localStorage，永不自动过期（覆盖自动定位）
 * 2. GPS 定位（仅 Android 壳）：原生 LocationManager（GPS/基站，MainActivity 的
 *    AndroidLocation 桥）→ 经纬度 → 逆地理编码（BigDataCloud，免费无 key、支持
 *    中文）成城市名。比 IP 定位准（国外 IP 库常把佛山判成深圳这类问题）；结果缓存 12 小时
 * 3. IP 定位：ipwho.is → ipinfo.io 依次尝试。两者均 https + CORS 开放、
 *    免费、无需 key；结果缓存 7 天，作为 GPS 失败后的兜底
 *
 * 不使用浏览器 Geolocation：它只返回经纬度，转城市名还需逆地理编码服务，
 * 授权弹窗与 Android WebView 权限配置的成本大于收益；GPS 定位桥走原生，
 * 权限弹窗由 MainActivity 管理（用户拒绝后自动降级 IP，不重复打扰）。
 */

const CITY_KEY = 'aishop_user_city';
/** GPS 自动定位结果缓存时长：人在城市间移动频率低，12 小时足够新 */
const GPS_CACHE_TTL = 12 * 60 * 60 * 1000;
/** IP 自动定位结果缓存时长：城市变动极低频，7 天可接受（仅作 GPS 失败兜底） */
const IP_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
/** 单次 IP 定位请求超时：失败快速降级，不让发消息流程等太久 */
const REQUEST_TIMEOUT = 2500;
/** GPS 定位（含权限弹窗等待）总超时：超时降级 IP，不让发消息流程等太久 */
const GPS_TIMEOUT = 20000;

interface StoredCity {
  city: string;
  source: 'manual' | 'auto';
  /** 自动定位的方式；手动设置无此字段（旧数据无字段视为 ip） */
  method?: 'gps' | 'ip';
  at: number;
}

function readStored(): StoredCity | null {
  try {
    const raw = localStorage.getItem(CITY_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as StoredCity;
    if (typeof rec.city !== 'string' || !rec.city.trim()) return null;
    return { ...rec, city: rec.city.trim() };
  } catch {
    return null;
  }
}

function isFresh(rec: StoredCity, now: number): boolean {
  const ttl = rec.method === 'gps' ? GPS_CACHE_TTL : IP_CACHE_TTL;
  return now - rec.at <= ttl;
}

/** 当前生效的城市（同步读，供系统提示词/搜索判断拼接）；无有效缓存返回 null */
export function getCachedCity(): string | null {
  const rec = readStored();
  if (!rec) return null;
  if (rec.source === 'manual') return rec.city;
  return isFresh(rec, Date.now()) ? rec.city : null;
}

/** 城市来源：manual=手动设置，auto=自动定位（过期视为未设置）；无记录返回 null */
export function getCitySource(): 'manual' | 'auto' | null {
  const rec = readStored();
  if (!rec) return null;
  if (rec.source === 'manual') return 'manual';
  return isFresh(rec, Date.now()) ? 'auto' : null;
}

/** 手动设置城市（覆盖自动定位，永久生效）；空字符串=清除手动设置 */
export function setManualCity(city: string): void {
  const trimmed = city.trim();
  if (trimmed) {
    localStorage.setItem(
      CITY_KEY,
      JSON.stringify({ city: trimmed, source: 'manual', at: Date.now() })
    );
  } else {
    localStorage.removeItem(CITY_KEY);
  }
}

/** 清除手动设置，恢复自动定位（缓存随之清空，下次 ensureCity 重新定位） */
export function clearManualCity(): void {
  localStorage.removeItem(CITY_KEY);
}

async function fetchJson(url: string, timeoutMs: number = REQUEST_TIMEOUT): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normalizeCity(raw: string | undefined): string {
  const t = (raw || '').trim();
  return t.length > 30 ? t.slice(0, 30) : t;
}

function hasGpsBridge(): boolean {
  const bridge = (window as unknown as {
    AndroidLocation?: { getCurrentPosition?: (callback: string) => void };
  }).AndroidLocation;
  return !!bridge?.getCurrentPosition;
}

/** GPS 定位（Android 壳原生桥）：返回经纬度；无桥/超时/失败返回 null */
async function locateByGps(): Promise<{ lat: number; lng: number } | null> {
  const bridge = (window as unknown as {
    AndroidLocation?: { getCurrentPosition?: (callback: string) => void };
  }).AndroidLocation;
  if (!bridge?.getCurrentPosition) return null;
  return new Promise(resolve => {
    const name = `__gpsLoc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const w = window as unknown as Record<string, unknown>;
    let timer: ReturnType<typeof setTimeout>;
    const handler = (lat: number | null, lng?: number) => {
      clearTimeout(timer);
      delete w[name];
      if (typeof lat === 'number' && typeof lng === 'number') resolve({ lat, lng });
      else resolve(null);
    };
    w[name] = handler;
    // 权限弹窗（首次）+ 定位可能较慢，总超时给足；超时后前端回退 IP 定位
    timer = setTimeout(() => {
      delete w[name];
      resolve(null);
    }, GPS_TIMEOUT);
    bridge.getCurrentPosition!(`window.${name}`);
  });
}

/** 逆地理编码：经纬度 → 城市名（BigDataCloud，免费无 key，支持中文返回） */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const data = (await fetchJson(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`,
      5000
    )) as { city?: string; locality?: string };
    return normalizeCity(data.city || data.locality);
  } catch {
    return null;
  }
}

/** IP 定位：ipwho.is 优先，ipinfo.io 兜底，都失败返回 null */
async function locateByIp(): Promise<string | null> {
  try {
    const data = (await fetchJson('https://ipwho.is/')) as { success?: boolean; city?: string };
    const city = normalizeCity(data.city);
    if (city && data.success !== false) return city;
  } catch {
    /* 换下一个服务 */
  }
  try {
    const data = (await fetchJson('https://ipinfo.io/json')) as { city?: string };
    const city = normalizeCity(data.city);
    if (city) return city;
  } catch {
    /* 都失败 */
  }
  return null;
}

/** 综合定位：GPS（Android 壳）优先，失败降级 IP；返回城市与定位方式 */
async function locateCity(): Promise<{ city: string; method: 'gps' | 'ip' } | null> {
  const gps = await locateByGps();
  if (gps) {
    const city = await reverseGeocode(gps.lat, gps.lng);
    if (city) return { city, method: 'gps' };
  }
  const city = await locateByIp();
  return city ? { city, method: 'ip' } : null;
}

function writeAutoCache(city: string, method: 'gps' | 'ip'): void {
  localStorage.setItem(
    CITY_KEY,
    JSON.stringify({ city, source: 'auto', method, at: Date.now() })
  );
}

let locating: Promise<string | null> | null = null;

/**
 * 确保城市可用（幂等）：
 * - 手动设置或新鲜缓存（GPS 12h / IP 7d）→ 直接返回
 * - 有 GPS 桥（Android 壳）时 IP 缓存不作为命中项（GPS 优先，避免 IP 库
 *   不准的城市长期占用），重新 GPS 定位；失败再走 IP
 * - 并发调用共享同一次定位请求
 */
export function ensureCity(): Promise<string | null> {
  const rec = readStored();
  const now = Date.now();
  if (rec?.source === 'manual') return Promise.resolve(rec.city);
  if (rec && isFresh(rec, now) && (rec.method === 'gps' || !hasGpsBridge())) {
    return Promise.resolve(rec.city);
  }
  if (!locating) {
    locating = locateCity()
      .then(result => {
        if (result) writeAutoCache(result.city, result.method);
        return result ? result.city : null;
      })
      .finally(() => {
        locating = null;
      });
  }
  return locating;
}

/** 启动预热：只走 IP 定位（不触发 GPS 权限弹窗），供 GPS 失败时立即兜底 */
export function prefetchCity(): void {
  const rec = readStored();
  const now = Date.now();
  if (rec?.source === 'manual') return;
  if (rec && isFresh(rec, now)) return;
  ensureCityByIp().catch(() => {
    /* 静默失败，发送时再试 */
  });
}

async function ensureCityByIp(): Promise<string | null> {
  const city = await locateByIp();
  if (city) writeAutoCache(city, 'ip');
  return city;
}
