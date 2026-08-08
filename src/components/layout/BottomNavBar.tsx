import { MessageSquare, Star, User } from 'lucide-react';
import type { TabMode } from '../../types';

interface BottomNavBarProps {
  activeTab: TabMode;
  onTabChange: (tab: TabMode) => void;
}

const navItems: { id: TabMode; label: string; Icon: typeof MessageSquare }[] = [
  { id: 'chat', label: '对话', Icon: MessageSquare },
  { id: 'favorites', label: '收藏', Icon: Star },
  { id: 'me', label: '我的', Icon: User },
];

export default function BottomNavBar({ activeTab, onTabChange }: BottomNavBarProps) {
  return (
    <div className="flex items-center justify-around shrink-0 bg-[var(--color-bg-base)] pb-[env(safe-area-inset-bottom,0px)]">
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
