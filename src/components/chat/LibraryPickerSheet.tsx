import { useState } from 'react';
import { Check, FileText, Image as ImageIcon, X } from 'lucide-react';
import BottomSheet from '../common/BottomSheet';
import BlobImage from '../common/BlobImage';
import type { AssetItem } from '../../types';
import { haptic } from '../../utils/haptics';

interface LibraryPickerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** 「我的库」全部资产 */
  assets: AssetItem[];
  /** 确定：把选中的资产内容回传到输入框 */
  onConfirm: (selected: AssetItem[]) => void;
}

/**
 * 安卓端附件面板的「库」二级面板：更高的底部面板（85vh），展示「我的库」全部资产，
 * 点击多选，底部「确定」把选中内容上传到输入框（图片进图片预览，文档/应用进文件列表）。
 * 仅 Android 原生壳使用；Web/Electron 不渲染此组件。
 */
export default function LibraryPickerSheet({ isOpen, onClose, assets, onConfirm }: LibraryPickerSheetProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleClose = () => {
    setSelectedIds(new Set());
    onClose();
  };

  const toggle = (id: string) => {
    haptic();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = assets.filter(a => selectedIds.has(a.id));
    if (selected.length === 0) return;
    haptic();
    onConfirm(selected);
    setSelectedIds(new Set());
    onClose();
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      <div className="flex-1 flex flex-col min-h-0">
        {/* 头部 */}
        <div className="px-5 pt-1 pb-5 shrink-0 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">我的库</h3>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-white/10"
            title="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 资产网格 */}
        <div className="flex-1 overflow-auto px-5">
          {assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <FileText className="w-12 h-12 text-gray-600 mb-3" />
              <p className="text-gray-500 text-sm">
                库还是空的，对话中收藏应用、保存文档或图片后会出现在这里
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pt-2 pb-4">
              {assets.map(item => {
                const selected = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    role="button"
                    onClick={() => toggle(item.id)}
                    className={`relative rounded-xl overflow-hidden bg-[var(--color-bg-secondary)] transition-all active:scale-95 select-none [-webkit-touch-callout:none] [-webkit-user-select:none] ${
                      selected ? 'ring-2 ring-[var(--color-accent)]' : ''
                    }`}
                  >
                    {/* 缩略图区 - 1:1 */}
                    <div className="aspect-square overflow-hidden flex items-center justify-center pointer-events-none">
                      {item.kind === 'markdown' ? (
                        <div className="w-full h-full p-2.5">
                          <p className="text-[11px] text-[var(--color-text-secondary)] break-all leading-snug">
                            {item.content}
                          </p>
                        </div>
                      ) : item.thumbnail ? (
                        <BlobImage
                          src={item.thumbnail}
                          alt={item.title}
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <ImageIcon className="w-7 h-7 text-[var(--color-text-secondary)]" />
                      )}
                    </div>

                    {/* 标题 */}
                    <div className="px-2 py-2 pointer-events-none">
                      <p className="text-xs text-[var(--color-text-primary)] truncate font-medium">{item.title}</p>
                    </div>

                    {/* 选中角标 */}
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg">
                        <Check className="w-4 h-4 text-[var(--color-accent-foreground)]" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="shrink-0 px-5 py-3 pb-8 border-t border-gray-700/50 flex items-center justify-between gap-3 bg-[var(--color-bg-primary)]">
          <span className="text-sm text-gray-400">已选 {selectedIds.size} 项</span>
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="px-7 py-2.5 rounded-full text-sm font-medium transition-all active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-foreground)' }}
          >
            确定
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
