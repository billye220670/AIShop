/**
 * 数据管理面板：备份导出/导入、存储占用、清理。
 *
 * 导出是唯一能扛住「浏览器清掉存储」的手段——iOS Safari 里的网页有七天
 * 不用即清的规则，用户手动「清除网站数据」连装机 PWA 的数据也一起删。
 * 所以这个面板不是锦上添花，是数据安全的兜底。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload, Trash2, HardDrive, Loader2 } from 'lucide-react';
import { exportBackup, readBackupFile, restoreBackup } from '../../services/backup';
import { sweepOrphanBlobs, getBlobStats } from '../../db';
import { getStorageEstimate, formatBytes, isAtRiskOfEviction } from '../../utils/pwa';

interface Stats {
  usage: number;
  quota: number;
  ratio: number;
  blobCount: number;
  blobBytes: number;
  orphanBytes: number;
}

export default function DataSettings() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | 'sweep' | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 只需算一次，运行期间不会变
  const [atRisk] = useState(isAtRiskOfEviction);

  const refresh = useCallback(async () => {
    const [estimate, blobs] = await Promise.all([getStorageEstimate(), getBlobStats()]);
    setStats({
      usage: estimate?.usage ?? 0,
      quota: estimate?.quota ?? 0,
      ratio: estimate?.ratio ?? 0,
      blobCount: blobs.count,
      blobBytes: blobs.bytes,
      orphanBytes: blobs.orphanBytes,
    });
  }, []);

  useEffect(() => {
    // 包一层空函数：直接 void refresh() 会被 lint 判成「在 effect 里同步 setState」。
    // 实际上 setState 发生在 await 之后，但换个写法比加 disable 干净。
    const run = () => { void refresh(); };
    run();
  }, [refresh]);

  const handleExport = async () => {
    setBusy('export');
    setMessage(null);
    try {
      await exportBackup();
      setMessage({ text: '备份已导出，建议存到文件 App 或云盘', ok: true });
    } catch (e) {
      setMessage({ text: `导出失败：${(e as Error).message}`, ok: false });
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (file: File) => {
    setBusy('import');
    setMessage(null);
    try {
      const result = await restoreBackup(await readBackupFile(file));
      setMessage({
        text: `已恢复 ${result.conversations} 个会话、${result.messages} 条消息，正在刷新…`,
        ok: true,
      });
      await refresh();
      // 会话列表在 useChat 启动时读入内存，恢复的数据不会自动出现。
      // 与其让用户自己去刷新，不如直接重载——恢复本来就是个低频动作。
      // 刻意不清除 busy：让按钮保持禁用直到页面重载，避免重复导入。
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      setMessage({ text: `恢复失败：${(e as Error).message}`, ok: false });
      setBusy(null);
    }
  };

  const handleSweep = async () => {
    setBusy('sweep');
    setMessage(null);
    try {
      const freed = await sweepOrphanBlobs();
      setMessage({
        text: freed > 0 ? `已清理 ${formatBytes(freed)}` : '没有可清理的内容',
        ok: true,
      });
      await refresh();
    } catch (e) {
      setMessage({ text: `清理失败：${(e as Error).message}`, ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-white">
          <HardDrive className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm font-medium">存储占用</span>
        </div>

        {stats ? (
          <div className="space-y-2 rounded-xl bg-white/5 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-gray-300">已使用</span>
              <span className="text-white">
                {formatBytes(stats.usage)}
                {stats.quota > 0 && (
                  <span className="text-gray-500"> / {formatBytes(stats.quota)}</span>
                )}
              </span>
            </div>
            {stats.quota > 0 && (
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                  style={{ width: `${Math.min(100, stats.ratio * 100).toFixed(1)}%` }}
                />
              </div>
            )}
            <div className="flex justify-between text-xs text-gray-400">
              <span>图片 {stats.blobCount} 张</span>
              <span>{formatBytes(stats.blobBytes)}</span>
            </div>
            {stats.orphanBytes > 0 && (
              <div className="text-xs text-amber-400/80">
                其中 {formatBytes(stats.orphanBytes)} 已无引用，可清理
              </div>
            )}
          </div>
        ) : (
          <div className="h-20 animate-pulse rounded-xl bg-white/5" />
        )}
      </section>

      <section className="space-y-3">
        <div className="text-sm font-medium text-white">备份</div>
        <p className="text-xs leading-relaxed text-gray-400">
          对话保存在浏览器本地。清除浏览器数据、系统回收存储都会导致丢失，
          定期导出到文件 App 或云盘才能真正保住。
        </p>
        {atRisk && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-400/90">
            当前在 Safari 中以网页方式运行。iOS 会清除连续七天未访问的网站数据，
            请务必定期导出备份。
          </p>
        )}

        <button
          onClick={handleExport}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white transition-opacity active:opacity-80 disabled:opacity-50"
        >
          {busy === 'export' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          导出全部对话
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-sm text-white transition-colors active:bg-white/15 disabled:opacity-50"
        >
          {busy === 'import' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          从备份恢复
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            // 清空 value，否则同一个文件选第二次不会触发 change
            e.target.value = '';
            if (file) void handleImport(file);
          }}
        />
        <p className="text-xs text-gray-500">
          恢复不会覆盖现有对话，导入的内容以新会话形式追加。
        </p>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-medium text-white">清理</div>
        <button
          onClick={handleSweep}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-sm text-white transition-colors active:bg-white/15 disabled:opacity-50"
        >
          {busy === 'sweep' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          清理无引用的图片
        </button>
      </section>

      {message && (
        <div
          className={`rounded-xl px-3 py-2 text-xs ${
            message.ok
              ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
              : 'bg-red-500/15 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
