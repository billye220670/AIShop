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
  /** 桶内对象统一前缀（写死 PortAI，不向用户暴露） */
  prefix: string;
  /** MinIO 等自建服务需要 path-style（endpoint/{bucket}/{key}）访问 */
  pathStyle: boolean;
  accessKey: string;
  secretKey: string;
  /** 最近一次成功同步时刻，仅用于 UI 展示 */
  lastSyncAt: number | null;
}

/** 桶内对象统一前缀：写死为 PortAI，不向用户暴露（多设备/多环境隔离靠独立 bucket） */
export const BYOC_KEY_PREFIX = 'PortAI';

export const DEFAULT_BYOC_CONFIG: ByocConfig = {
  enabled: false,
  provider: 'cos',
  endpoint: '',
  region: '',
  bucket: '',
  prefix: BYOC_KEY_PREFIX,
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
    roles: string[];
    /** 资产删除记录（favs 是 artifact 资产的旧版镜像，删除同时命中 assets） */
    assets: string[];
  };
  /** imageHistory 当前 id 集合（index 文件，拉取方以它为准删减） */
  historyIds: string[];
  /** 收藏当前 id 集合（artifact 资产的兼容镜像） */
  favIds: string[];
  /** 角色当前 id 集合 */
  roleIds: string[];
  /** 「我的库」资产当前 id 集合（旧版本清单没有，读侧兜底空数组） */
  assetIds: string[];
  /**
   * 各条目的版本号（推送方的 updatedAt）。
   *
   * 只有 id 集合时，拉取方无法区分「云端这条改过了」和「云端这条一直没变」，
   * 于是只能做「本地没有才拉」——修改永远传不到其他设备。有了版本号，
   * 拉取方把它与「上次应用过的版本」对比即可发现修改。
   * 旧版本清单没有这些字段，读侧一律兜底空对象。
   */
  assetVers?: Record<string, number>;
  roleVers?: Record<string, number>;
  historyVers?: Record<string, number>;
  /** API 设置（providers + apiKeys）最后推送时刻；旧版本清单没有，读侧兜底 0 */
  settingsUpdatedAt?: number;
}

/**
 * 随 BYOC 同步的 API 设置子集：只含供应商选择与 API Key。
 *
 * 排除 byoc 配置本身（新设备必须先配 BYOC 才能连桶，鸡生蛋问题）、
 * 主题/压缩等纯本机偏好。整体作为一个对象上传 sync/v1/settings.json，
 * 冲突策略为 LWW（updatedAt 大者胜），与会话元数据一致。
 */
export interface SyncedSettings {
  providers: { llm: string; image: string; search: string };
  apiKeys: Record<string, string>;
  /** 自建提供商服务地址（如 Pix2Real）；旧版本云端数据没有此字段，读侧按缺省处理 */
  baseUrls?: Record<string, string>;
  /** 辅助模型（意图识别 / 生图优化 / 标题生成 / 智能路由 / 联网搜索判断）；旧版本云端数据没有此字段，读侧保留本机值 */
  assistModels?: Partial<Record<'intentJudge' | 'promptOptimize' | 'titleGen' | 'routeJudge' | 'searchJudge', string>>;
}

/** 本地 API 设置变更后触发立即同步的事件名（设置写入侧 dispatch，同步调度侧监听） */
export const BYOC_SETTINGS_DIRTY_EVENT = 'aishop:byoc-settings-dirty';
/** 云端 API 设置拉回写进本地后的事件名（同步侧 dispatch，设置面板监听重读） */
export const SETTINGS_SYNCED_EVENT = 'aishop:settings-synced';

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
