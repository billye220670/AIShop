import { useState, useCallback, useEffect, useRef } from 'react';
import type { ArtifactBlock, AssetItem, ImageHistoryItem } from '../types';
import {
  listAssets,
  saveArtifact as dbSaveArtifact,
  saveMarkdown as dbSaveMarkdown,
  saveImageHistory as dbSaveImageHistory,
  removeAsset as dbRemoveAsset,
  renameAsset as dbRenameAsset,
  findMarkdownBySourceRef as dbFindMarkdownBySourceRef,
} from '../db';
import { generateDocumentTitle } from '../services/titleGenerator';
import { safeSync } from '../services/byoc';

/**
 * 「我的库」资产状态。
 *
 * 缩略图/图片存在 IndexedDB 里，thumbnail/urls 是 aishop-blob:<id> 形式，
 * 渲染处需要用 useBlobUrl 解析。
 *
 * 写库与本地 state 分别更新：先改 state 让界面立刻响应，再异步落库。
 * 保存是低频操作，失败了下次操作会覆盖，不做回滚。
 */
export function useAssets() {
  const [assets, setAssets] = useState<AssetItem[]>([]);

  // 资产变更后防抖 3 秒触发一次 BYOC 同步（与 useChat 对话变更同步一致），
  // 让保存/删除/重命名及时上云；60 秒轮询与回前台拉取继续兜底。
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      void safeSync();
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  }, []);

  useEffect(() => {
    const load = () => {
      void listAssets()
        .then(setAssets)
        .catch(e => console.error('[useAssets] 加载失败', e));
    };
    load();
  }, []);

  /** 立即同步一次（保存入口在别的组件时，进入库页前调用保证新鲜） */
  const refresh = useCallback(() => {
    void listAssets()
      .then(setAssets)
      .catch(e => console.error('[useAssets] 刷新失败', e));
  }, []);

  const saveArtifact = useCallback((artifact: ArtifactBlock, thumbnail: string, convId?: string) => {
    setAssets(prev => {
      if (prev.some(a => a.id === artifact.id)) return prev;
      // state 里先放传入的 base64，落库后它会被换成 blob 引用；
      // 两种形式 useBlobUrl 都认，所以中间态不影响渲染。
      return [
        ...prev,
        { id: artifact.id, kind: 'artifact', title: artifact.title, artifact: { ...artifact }, thumbnail, convId, createdAt: Date.now() },
      ];
    });
    void dbSaveArtifact(artifact, thumbnail, convId)
      .then(listAssets)
      .then(setAssets)
      .then(scheduleSync)
      .catch(e => console.error('[useAssets] 保存 artifact 失败', e));
  }, [scheduleSync]);

  const saveMarkdown = useCallback(
    (messageId: string, title: string, content: string, convId?: string) => {
      void (async () => {
        // 已保存过的源消息不再重复入库，也跳过标题模型调用
        const existing = await dbFindMarkdownBySourceRef(messageId);
        if (existing) {
          await refresh();
          return;
        }
        // 所有 md 保存到库统一入口：小模型总结标题（无 key/失败时回退内容截取），
        // 以生成结果落库，保证「我的库」里的标题是总结出来的
        const finalTitle = (await generateDocumentTitle(content)) || title;
        await dbSaveMarkdown(messageId, finalTitle, content, convId);
        await refresh();
        scheduleSync();
      })().catch(e => console.error('[useAssets] 保存 markdown 失败', e));
    },
    [refresh, scheduleSync]
  );

  const saveImage = useCallback(
    (item: ImageHistoryItem, convId?: string) => {
      setAssets(prev => {
        if (prev.some(a => a.id === item.id)) return prev;
        return [
          ...prev,
          {
            id: item.id,
            kind: 'image',
            title: item.prompt.slice(0, 50) || '图片',
            urls: item.urls,
            thumbnail: item.urls[0],
            createdAt: Date.now(),
            sourceRef: item.id,
            convId,
          },
        ];
      });
      void dbSaveImageHistory(item, convId)
        .then(listAssets)
        .then(setAssets)
        .then(scheduleSync)
        .catch(e => console.error('[useAssets] 保存图片失败', e));
    },
    [scheduleSync]
  );

  const removeAsset = useCallback((id: string) => {
    setAssets(prev => prev.filter(a => a.id !== id));
    void dbRemoveAsset(id)
      .then(scheduleSync)
      .catch(e => console.error('[useAssets] 移除资产失败', e));
  }, [scheduleSync]);

  const renameAsset = useCallback((id: string, newTitle: string) => {
    setAssets(prev =>
      prev.map(a =>
        a.id === id
          ? {
              ...a,
              title: newTitle,
              artifact: a.artifact ? { ...a.artifact, title: newTitle } : undefined,
            }
          : a
      )
    );
    void dbRenameAsset(id, newTitle)
      .then(scheduleSync)
      .catch(e => console.error('[useAssets] 重命名失败', e));
  }, [scheduleSync]);

  const isSaved = useCallback(
    (id: string) => assets.some(a => a.id === id),
    [assets]
  );

  const toggleArtifact = useCallback(
    (artifact: ArtifactBlock, thumbnail?: string, convId?: string) => {
      const already = assets.some(a => a.id === artifact.id);
      if (already) {
        removeAsset(artifact.id);
        return;
      }
      if (!thumbnail) return; // 保存时必须有缩略图
      saveArtifact(artifact, thumbnail, convId);
    },
    [assets, saveArtifact, removeAsset]
  );

  return {
    assets,
    refresh,
    saveArtifact,
    saveMarkdown,
    saveImage,
    removeAsset,
    renameAsset,
    isSaved,
    toggleArtifact,
  };
}
