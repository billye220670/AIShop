/**
 * 数据库连接与写入串行化。
 *
 * 两件事在这里集中处理：
 * - Safari 在内存压力下偶发抛 IDB UnknownError。所有仓库操作都走 withDB，
 *   失败时重开连接重试一次。
 * - 流式输出期间写入很密集，按会话串行化，避免同一条消息的多次更新互相穿插。
 */
import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, type AiShopDB } from './schema';

let dbPromise: Promise<IDBPDatabase<AiShopDB>> | null = null;

function create(): Promise<IDBPDatabase<AiShopDB>> {
  return openDB<AiShopDB>(DB_NAME, DB_VERSION, {
    // 迁移涉及跨 store 读改写，回调做成 async：所有 request 都在同一个
    // versionchange 事务内同步发起，await 只是控制执行顺序，不影响事务活性。
    async upgrade(db, _oldVersion, _newVersion, tx) {
      // 旧版本库升级时会重跑本回调，已存在的 store 必须跳过，否则重复创建抛错
      if (!db.objectStoreNames.contains('conversations')) {
        const conversations = db.createObjectStore('conversations', { keyPath: 'id' });
        conversations.createIndex('by_updatedAt', 'updatedAt');
        // isFavorite 是可选布尔，索引不到 undefined，所以按需查询时以 1/0 存
        conversations.createIndex('by_favorite', 'isFavorite');
      }

      if (!db.objectStoreNames.contains('messages')) {
        const messages = db.createObjectStore('messages', { keyPath: 'id' });
        messages.createIndex('by_conv_seq', ['convId', 'seq']);
        messages.createIndex('by_conv_time', ['convId', 'timestamp']);
      }

      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'blobId' });
      }

      if (!db.objectStoreNames.contains('contextNodes')) {
        const contextNodes = db.createObjectStore('contextNodes', { keyPath: 'id' });
        contextNodes.createIndex('by_conv', 'convId');
      }

      if (!db.objectStoreNames.contains('contextPlans')) {
        const contextPlans = db.createObjectStore('contextPlans', { keyPath: 'id' });
        contextPlans.createIndex('by_conv', 'convId');
      }

      if (!db.objectStoreNames.contains('retrieval')) {
        const retrieval = db.createObjectStore('retrieval', { keyPath: 'messageId' });
        retrieval.createIndex('by_conv', 'convId');
        retrieval.createIndex('terms', 'terms', { multiEntry: true });
      }

      if (!db.objectStoreNames.contains('imageHistory')) {
        const imageHistory = db.createObjectStore('imageHistory', { keyPath: 'id' });
        imageHistory.createIndex('by_timestamp', 'timestamp');
      }

      if (!db.objectStoreNames.contains('favoriteArtifacts')) {
        const favorites = db.createObjectStore('favoriteArtifacts', { keyPath: 'id' });
        favorites.createIndex('by_favoritedAt', 'favoritedAt');
      }

      if (!db.objectStoreNames.contains('assets')) {
        const assets = db.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('by_createdAt', 'createdAt');
        assets.createIndex('by_kind', 'kind');

        // 一次性迁移旧收藏 → assets（kind=artifact）。旧 store 保留不删，
        // 万一回退旧版本 App 数据仍在。blob 引用原样带过，引用计数不动。
        if (db.objectStoreNames.contains('favoriteArtifacts')) {
          const recs = await tx.objectStore('favoriteArtifacts').getAll();
          for (const rec of recs) {
            await tx.objectStore('assets').put({
              id: rec.id,
              kind: 'artifact',
              title: rec.artifact.title,
              createdAt: rec.favoritedAt,
              artifact: rec.artifact,
              thumbnailBlobId: rec.thumbnailBlobId,
              updatedAt: rec.favoritedAt,
              syncedAt: null,
            });
          }
        }
      }

      if (!db.objectStoreNames.contains('roles')) {
        const roles = db.createObjectStore('roles', { keyPath: 'id' });
        roles.createIndex('by_createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    },
    blocked() {
      // 另一个标签页占着旧版本连接。除了等没别的办法，至少留下线索。
      console.warn('[db] 升级被其他标签页阻塞');
    },
    blocking() {
      // 本标签页挡住了别处的升级：主动让路，下次访问会自动重开。
      void closeDB();
    },
    terminated() {
      dbPromise = null;
    },
  });
}

export function getDB(): Promise<IDBPDatabase<AiShopDB>> {
  if (!dbPromise) dbPromise = create();
  return dbPromise;
}

export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  const pending = dbPromise;
  dbPromise = null;
  try {
    (await pending).close();
  } catch {
    /* 已经关掉了 */
  }
}

/** 所有仓库操作的入口：失败时重开连接重试一次 */
export async function withDB<T>(
  fn: (db: IDBPDatabase<AiShopDB>) => Promise<T>
): Promise<T> {
  try {
    return await fn(await getDB());
  } catch (e) {
    // AbortError 通常意味着连接已失效，重开一次值得试
    console.warn('[db] 操作失败，重开连接重试', e);
    await closeDB();
    return fn(await getDB());
  }
}

// ---------- 按 key 串行化的写队列 ----------

const queues = new Map<string, Promise<unknown>>();

/**
 * 把同一 key（通常是会话 id）下的写操作排成一列。
 *
 * 返回值是本次任务自己的结果；前一个任务失败不会阻断后续任务。
 */
export function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  // 存进 map 的是已吞掉异常的版本，避免未处理的 rejection，
  // 也保证前一个任务失败不会阻断后续任务。
  const settled = next.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, settled);
  // 队列排空后清掉条目，避免 map 随会话数无限增长
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}
