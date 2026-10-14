import IP2RegionNS from 'ip2region';

// ip2region 是 CJS，ESM 下 default 会被包一层，取 .default 兜住两种形态
const IP2Region = ((IP2RegionNS as unknown as { default?: typeof IP2RegionNS }).default
  ?? IP2RegionNS) as typeof IP2RegionNS;

export interface Region {
  /** 归一化后的省份名；查不到为 null */
  province: string | null;
  /** 归一化后的城市名；查不到为 null */
  city: string | null;
  /** 来源：离线库 / 反代 header / 查不到 */
  source: 'db' | 'header' | 'none';
}

export const UNKNOWN_PROVINCE = '未知';
export const OVERSEAS_PROVINCE = '境外';

/** 自治区 / 特别行政区 / 台湾：库里的短名不带后缀，补「省/市」反而错 */
const PROVINCE_NO_SUFFIX = new Set([
  '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门', '台湾',
]);
const AUTONOMOUS_SUFFIX = /^(.+)(省|自治区|特别行政区|市|县)$/;
/** 库把内网段 / 查不到的段标记成这些值 */
const MEANINGLESS = new Set(['', '0', '-', '内网IP', '内网', '未知', '未知地区']);

/** 库可能返回的裸省份名 → 规范名 */
const PROVINCE_ALIAS: Record<string, string> = {
  北京: '北京市',
  上海: '上海市',
  天津: '天津市',
  重庆: '重庆市',
  香港: '香港',
  澳门: '澳门',
  台湾: '台湾',
};

function clean(raw: string | null | undefined): string {
  if (raw == null) return '';
  // 去掉控制字符和首尾空白，限制长度防脏数据把库撑爆
  return String(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
}

function isMeaningless(value: string): boolean {
  return MEANINGLESS.has(value) || value.startsWith('内网');
}

/** 国家字段只用来判「是不是中国大陆」，不能拿 MEANINGLESS 那套判（'中国' 是有效国别） */
function hasCountry(v: string): boolean {
  return v.length > 0 && !MEANINGLESS.has(v) && !v.startsWith('内网');
}

export function normalizeProvince(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (isMeaningless(v)) return null;
  // province 字段返回「中国」= 库只知道国别，不知道省
  if (v === '中国') return null;
  if (PROVINCE_ALIAS[v]) return PROVINCE_ALIAS[v];
  if (PROVINCE_NO_SUFFIX.has(v)) return v;
  if (AUTONOMOUS_SUFFIX.test(v)) return v;
  return `${v}省`;
}

export function normalizeCity(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (isMeaningless(v)) return null;
  return v;
}

// ── 离线库：懒加载 + LRU 缓存 ──────────────────────────────────────────────
// db 8.7MB 常驻内存没问题，但没必要在后端启动时就 load；第一次真正需要
// 归属时再建索引（建索引约 100ms，放在 track 的请求路径上会有一次性抖动，
// 因此这里同步等待而不是丢后台）。

let db: IP2RegionNS | null = null;
let dbLoaded = false;
let dbFailed = false;

const CACHE_MAX = 4096;
const cache = new Map<string, Region>();

function loadDb(): IP2RegionNS | null {
  if (dbLoaded) return db;
  dbLoaded = true;
  try {
    db = new IP2Region();
  } catch (e) {
    dbFailed = true;
    console.warn('[geo] ip2region 初始化失败，来源地将全部记为未知:', e);
  }
  return db;
}

function cacheSet(key: string, value: Region): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

const NONE: Region = { province: null, city: null, source: 'none' };

function lookupDb(ip: string): Region {
  const hit = cache.get(ip);
  if (hit) return hit;

  const query = loadDb();
  if (!query) return NONE;

  let result: Region;
  try {
    const raw = query.search(ip);
    const country = clean(raw?.country);
    if (!raw || !hasCountry(country)) {
      result = NONE;
    } else if (country !== '中国') {
      result = { province: OVERSEAS_PROVINCE, city: normalizeCity(raw.city), source: 'db' };
    } else {
      result = {
        province: normalizeProvince(raw.province),
        city: normalizeCity(raw.city),
        source: 'db',
      };
    }
  } catch (e) {
    console.warn('[geo] 查询失败:', ip, e);
    result = NONE;
  }
  cacheSet(ip, result);
  return result;
}

/**
 * 反代 header 通道：nginx geoip2 模块可以注入省 / 市，取不到时自动回落到
 * 离线库。这样「服务器装了 geoip2」和「没装」对后端是同一套代码。
 * 用它需要显式设 PINGDOU_TRUST_GEO_HEADER=1，避免有人伪造 header 灌脏数据。
 */
function fromHeaders(headers: Record<string, unknown>): Region | null {
  if (process.env.PINGDOU_TRUST_GEO_HEADER !== '1') return null;
  const province = normalizeProvince(headerString(headers['x-geo-province']));
  const city = normalizeCity(headerString(headers['x-geo-city']));
  if (!province) return null;
  return { province, city, source: 'header' };
}

/** nginx header 可能是 string / string[] / undefined，统一收敛成 string */
function headerString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

/** 私有网段 / 非法 IP 直接跳过库查询 */
function isRoutableIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return false;
  if (ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.')
    || ip.startsWith('172.19.') || ip.startsWith('172.2') || ip.startsWith('172.30.')
    || ip.startsWith('172.31.')) return false;
  if (ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('::')) return false;
  return true;
}

export function resolveRegion(ip: string, headers?: Record<string, unknown>): Region {
  const viaHeader = headers ? fromHeaders(headers) : null;
  if (viaHeader) return viaHeader;
  if (dbFailed) return NONE;
  if (!isRoutableIp(ip)) return NONE;
  return lookupDb(ip);
}

export function geoStatus(): { available: boolean; cached: number } {
  return { available: dbLoaded && !dbFailed, cached: cache.size };
}

/** 测试用：清掉懒加载状态和缓存 */
export function __resetGeoForTest(): void {
  db = null;
  dbLoaded = false;
  dbFailed = false;
  cache.clear();
}
