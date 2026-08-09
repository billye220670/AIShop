/**
 * BYOC（Bring Your Own Cloud）类型定义。
 *
 * 设计目标与 Obsidian BYOC 一致：用户自带 S3 兼容对象存储（腾讯云 COS、
 * 阿里云 OSS、Cloudflare R2、MinIO 等），对话数据直接同步到用户自己的桶，
 * 应用本身不提供也不依赖任何云端中转。
 */

/** 内置服务商预设。endpoint/region/pathStyle 均可被用户覆盖。 */
export type ByocProvider = 'cos' | 'oss' | 'r2' | 'minio' | 'b2' | 'custom';

export interface ByocConfig {
  /** 是否启用自动同步（手动按钮不受此开关限制） */
  enabled: boolean;
  provider: ByocProvider;
  /** 存储主机名，可带端口，如 cos.ap-guangzhou.myqcloud.com 或 127.0.0.1:9000 */
  endpoint: string;
  region: string;
  bucket: string;
  /** 桶内对象统一前缀，默认 aishop */
  prefix: string;
  /** MinIO 等自建服务需要 path-style（endpoint/{bucket}/{key}）访问 */
  pathStyle: boolean;
  accessKey: string;
  secretKey: string;
  /** 最近一次成功同步时刻，仅用于 UI 展示 */
  lastSyncAt: number | null;
}

export const DEFAULT_BYOC_CONFIG: ByocConfig = {
  enabled: false,
  provider: 'cos',
  endpoint: '',
  region: '',
  bucket: '',
  prefix: 'aishop',
  pathStyle: false,
  accessKey: '',
  secretKey: '',
  lastSyncAt: null,
};

/** 服务商预设：选预设时自动填充 endpoint/region/pathStyle，用户仍可改 */
export const BYOC_PROVIDER_PRESETS: Record<
  Exclude<ByocProvider, 'custom'>,
  { endpoint: string; region: string; pathStyle: boolean }
> = {
  cos: { endpoint: '', region: 'ap-guangzhou', pathStyle: false },
  oss: { endpoint: '', region: 'cn-hangzhou', pathStyle: false },
  r2: { endpoint: '', region: 'auto', pathStyle: false },
  minio: { endpoint: '', region: 'us-east-1', pathStyle: true },
  b2: { endpoint: '', region: 'us-west-004', pathStyle: false },
};

/**
 * 云端同步清单（增量层唯一的"目录"）。
 *
 * 每轮推送都会重写整个清单；拉取方只读清单 + 变更对象，不扫描整个桶。
 * tombstones 记录删除，让删除也能跨设备传播（数据只增不减是安全方向）。
 */
export interface SyncManifestV1 {
  schema: 'aishop-sync-v1';
  /** 最后推送方设备 id */
  deviceId: string;
  /** 清单最后变更时刻 */
  updatedAt: number;
  /** convId -> 该会话最后写入时刻（用于拉取方判断是否需要拉） */
  convs: Record<string, number>;
  tombstones: {
    convs: string[];
    history: string[];
    favs: string[];
  };
  /** imageHistory 当前 id 集合（index 文件，拉取方以它为准删减） */
  historyIds: string[];
  /** 收藏当前 id 集合 */
  favIds: string[];
}

/** 单轮同步的统计结果，供 UI 展示 */
export interface SyncResult {
  pushedConvs: number;
  pushedMessages: number;
  pushedBlobs: number;
  pulledConvs: number;
  pulledMessages: number;
  pulledBlobs: number;
  deletedConvs: number;
}

/** 云备份（全量层）结果 */
export interface CloudBackupResult {
  key: string;
  bytes: number;
}

/** 同步进度回调（备份/同步共用） */
export type ProgressFn = (done: number, total: number) => void;
