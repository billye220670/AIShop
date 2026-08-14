import { MessageSquare, Library, User } from 'lucide-react';
import type { TabMode } from '../../types';
import { isNativeAndroid } from '../../platform/capabilities';

interface BottomNavBarProps {
  activeTab: TabMode;
  onTabChange: (tab: TabMode) => void;
}

const navItems: { id: TabMode; label: string; Icon: typeof MessageSquare }[] = [
  { id: 'chat', label: '对话', Icon: MessageSquare },
  { id: 'library', label: '我的库', Icon: Library },
  { id: 'me', label: '我的', Icon: User },
];

export default function BottomNavBar({ activeTab, onTabChange }: BottomNavBarProps) {
  return (
    <div
      className="flex items-center justify-around shrink-0 bg-[var(--color-bg-base)] pb-[env(safe-area-inset-bottom,0px)]"
      // Android 壳：底部避让手势条（原生注入的 --native-inset-bottom）+ 额外 12px 视觉间距；其他端用 env() 兜底
      style={isNativeAndroid() ? { paddingBottom: 'calc(var(--native-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px)' } : undefined}
    >
      {navItems.map(item => {
        const isActive = activeTab === item.id;
        const Icon = item.Icon;
        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`p-3 transition-colors ${
              isActive
                ? 'text-[var(--color-accent)]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icon className="w-5 h-5" fill={isActive ? 'currentColor' : 'none'} />
          </button>
        );
      })}
    </div>
  );
}
