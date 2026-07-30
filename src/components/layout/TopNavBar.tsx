import { Menu, MessageSquarePlus } from 'lucide-react';
import type { Model } from '../../types';
import ModelSelector from '../common/ModelSelector';
import { APP_VERSION } from '../../config/version';

interface TopNavBarProps {
  onToggleSidebar: () => void;
  models: Model[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  onNewConversation?: () => void;
}

export default function TopNavBar({
  onToggleSidebar,
  models,
  selectedModel,
  onModelChange,
  onNewConversation,
}: TopNavBarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 shrink-0">
      {/* 左侧：汉堡菜单 + 模型选择器 */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg"
          title="菜单"
        >
          <Menu className="w-5 h-5" />
        </button>

        <ModelSelector
          models={models}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          compact={true}
        />
      </div>

      {/* 右侧：版本号 + 新建对话 */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 font-mono">v{APP_VERSION}</span>
        <button
          onClick={() => onNewConversation?.()}
          className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg"
          title="新建对话"
        >
          <MessageSquarePlus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
