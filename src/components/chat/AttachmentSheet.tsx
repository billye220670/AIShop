import { Images, Camera, FileText } from 'lucide-react';
import BottomSheet from '../common/BottomSheet';
import { haptic } from '../../utils/haptics';

interface AttachmentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** 打开相册选择图片（Android 原生 Photo Picker） */
  onPickGallery: () => void;
  /** 打开相机拍照（Android 原生相机） */
  onTakePhoto: () => void;
  /** 打开系统文件选择器（Android SAF） */
  onPickFiles: () => void;
}

/**
 * 安卓端 + 号按钮的附件选择面板：较矮的底部弹出面板，横向排列 相册/拍摄/文件 三个原生入口。
 * 样式与移动端模型选择器（ModelBottomSheet）同源（共用 BottomSheet），仅高度矮。
 * 仅 Android 原生壳使用；Web/Electron 不渲染此组件。
 */
export default function AttachmentSheet({ isOpen, onClose, onPickGallery, onTakePhoto, onPickFiles }: AttachmentSheetProps) {
  const actions = [
    { label: '相册', icon: Images, onClick: onPickGallery },
    { label: '拍摄', icon: Camera, onClick: onTakePhoto },
    { label: '文件', icon: FileText, onClick: onPickFiles },
  ];

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} heightClass="h-auto">
      <div className="px-6 pt-1 pb-12">
        <div className="flex items-center justify-around">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              onClick={() => { haptic(); onClick(); }}
              className="flex flex-col items-center gap-3 active:scale-95 transition-transform"
            >
              <div className="w-20 h-20 rounded-2xl bg-[var(--color-bg-secondary)]/60 flex items-center justify-center">
                <Icon className="w-7 h-7 text-[var(--color-text-primary)]" strokeWidth={1.5} />
              </div>
              <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
