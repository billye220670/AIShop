import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Trash2, UserRound, Plus, ChevronDown } from 'lucide-react';
import { createRole, deleteRole, type RoleData } from '../../db';

interface RoleSelectorProps {
  roles?: RoleData[];
  selectedRoleId?: string;
  onRoleSelect?: (roleId: string) => void;
  /** 角色创建/删除后通知上层重读列表 */
  onRolesChanged?: () => void;
}

const MENU_GAP = 4;
const MENU_TOP_PADDING = 16; // 菜单距视口顶部的最小间距

interface MenuPosition {
  top?: number;      // bottom placement 使用
  bottom?: number;   // top placement 使用
  left: number;
  width: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
}

/**
 * 桌面端角色选择器：外壳与 ModelSelector（非 compact 下拉）完全一致——
 * 同款 trigger、fixed 定位下拉、进出动画与关闭逻辑；内容是角色列表（默认角色 + 自定义角色），
 * 底部可展开创建视图；角色项右侧删除按钮采用两次点击确认（与 ModelBottomSheet 一致）。
 */
export default function RoleSelector({
  roles = [],
  selectedRoleId = '',
  onRoleSelect = () => {},
  onRolesChanged = () => {},
}: RoleSelectorProps) {
  const [open, setOpen] = useState(false);
  const [animVisible, setAnimVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  // 下拉内页：列表 / 创建角色
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [newRolePrompt, setNewRolePrompt] = useState('');
  const [creating, setCreating] = useState(false);
  // 删除角色：第一次点击进入确认态，3 秒内再点才真正删除
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const deleteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const currentRoleName = selectedRoleId
    ? (roles.find(r => r.id === selectedRoleId)?.name || '自定义角色')
    : 'PortAI';

  // 关闭菜单：在事件回调中同步清除动画状态，避免 effect 内 setState
  const close = () => {
    setOpen(false);
    setAnimVisible(false);
  };

  // 打开菜单：同步挂载 DOM
  const toggle = () => {
    if (!open) {
      clearTimeout(unmountTimer.current);
      setMounted(true);
      setOpen(true);
    } else {
      close();
    }
  };

  // 动画控制：打开时触发进入动画，关闭时延迟卸载 DOM
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimVisible(true));
      });
    } else {
      unmountTimer.current = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(unmountTimer.current);
    }
  }, [open]);

  // 计算弹出菜单的定位（fixed 坐标，不受祖先 overflow:hidden 影响）
  useLayoutEffect(() => {
    if (!open || !mounted || !buttonRef.current) return;
    const recalc = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP - MENU_TOP_PADDING;
      const placement: 'top' | 'bottom' =
        spaceBelow >= spaceAbove ? 'bottom' : 'top';
      const maxHeight = Math.max(
        120,
        placement === 'bottom' ? spaceBelow - MENU_TOP_PADDING : spaceAbove
      ) / 2;
      if (placement === 'bottom') {
        setPos({
          top: rect.bottom + MENU_GAP,
          left: rect.left,
          width: rect.width,
          maxHeight,
          placement,
        });
      } else {
        setPos({
          bottom: window.innerHeight - rect.top + MENU_GAP,
          left: rect.left,
          width: rect.width,
          maxHeight,
          placement,
        });
      }
    };
    // 使用 rAF 确保 DOM 完全渲染后再测量位置
    requestAnimationFrame(recalc);
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [mounted, open]);

  // ESC 和外部点击关闭
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleRoleSelect = (roleId: string) => {
    onRoleSelect(roleId);
    close();
  };

  const handleDeleteRole = (roleId: string) => {
    if (confirmDeleteId !== roleId) {
      setConfirmDeleteId(roleId);
      clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    clearTimeout(deleteTimer.current);
    setConfirmDeleteId(null);
    void deleteRole(roleId)
      .then(() => {
        // 删掉的是当前选中角色 → 回退默认角色
        if (selectedRoleId === roleId) onRoleSelect('');
        onRolesChanged();
      })
      .catch(e => console.warn('[roles] 删除角色失败', e));
  };

  const handleCreateRole = () => {
    const prompt = newRolePrompt.trim();
    if (!prompt || creating) return;
    setCreating(true);
    void createRole(prompt)
      .then(() => {
        setNewRolePrompt('');
        setCreating(false);
        onRolesChanged();
        setMode('list');
      })
      .catch(e => {
        console.warn('[roles] 创建角色失败', e);
        setCreating(false);
      });
  };

  // 渲染单个角色项
  const renderRoleItem = (role: RoleData) => {
    const active = role.id === selectedRoleId;
    const confirming = confirmDeleteId === role.id;
    return (
      <li
        key={role.id}
        className={`flex items-center gap-1 pl-4 pr-2 py-2 text-sm transition-colors ${
          active
            ? 'bg-[var(--color-accent-soft)] text-white rounded-lg mx-2 !w-[calc(100%-1rem)] border border-[var(--color-accent)]'
            : 'text-gray-300 hover:bg-[var(--color-bg-hover)]'
        }`}
      >
        <button
          type="button"
          onClick={() => handleRoleSelect(role.id)}
          className="flex-1 flex items-center gap-2.5 text-left min-w-0"
        >
          <span className="w-6 h-6 shrink-0 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center">
            <UserRound className="w-3.5 h-3.5 text-gray-400" />
          </span>
          <span className="whitespace-nowrap overflow-hidden text-ellipsis">{role.name}</span>
        </button>
        <button
          type="button"
          onClick={() => handleDeleteRole(role.id)}
          title={confirming ? '再次点击确认删除' : '删除角色'}
          className={`shrink-0 p-1.5 rounded-lg transition-colors ${
            confirming
              ? 'bg-red-500/20 text-red-400'
              : 'text-gray-500 hover:text-red-400 hover:bg-white/5'
          }`}
        >
          {confirming ? <span className="text-xs font-medium">确认</span> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </li>
    );
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 text-sm cursor-pointer rounded-full h-9 bg-[var(--color-bg-button)]/80 px-4 hover:bg-[var(--color-bg-button)] transition-colors"
      >
        <Bot className="w-4 h-4 shrink-0" />
        <span className="whitespace-nowrap">{currentRoleName}</span>
        <div className="w-px h-5 bg-white/10" />
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {mounted && pos && (
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              ...(pos.top !== undefined ? { top: pos.top } : {}),
              ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
              left: pos.left,
              minWidth: Math.max(pos.width, 220),
              maxHeight: pos.maxHeight,
            }}
            className={`z-[1000] overflow-hidden bg-[var(--color-bg-elevated)] border border-white/5 rounded-xl shadow-2xl
              transition-all duration-200 ease-out ${pos.placement === 'bottom' ? 'origin-top' : 'origin-bottom'}
              ${animVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
          >
            {mode === 'list' ? (
              <>
                <ul
                  role="listbox"
                  className="overflow-y-auto py-3 h-full max-h-[inherit]"
                >
                  {/* 默认角色 */}
                  <li
                    className={`flex items-center gap-2.5 pl-4 pr-4 py-2 text-sm transition-colors ${
                      !selectedRoleId
                        ? 'bg-[var(--color-accent-soft)] text-white rounded-lg mx-2 !w-[calc(100%-1rem)] border border-[var(--color-accent)]'
                        : 'text-gray-300 hover:bg-[var(--color-bg-hover)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleRoleSelect('')}
                      className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                    >
                      <Bot className="w-4 h-4 shrink-0 text-gray-400" />
                      <span className="whitespace-nowrap">PortAI</span>
                    </button>
                  </li>

                  {/* 自定义角色 */}
                  {roles.length > 0 && (
                    <li>
                      <div className="px-4 pt-4 pb-1.5 text-sm font-bold text-[var(--color-text-tertiary)]">
                        自定义角色
                      </div>
                      <ul>
                        {roles.map(role => renderRoleItem(role))}
                      </ul>
                    </li>
                  )}
                </ul>

                {/* 创建角色入口 */}
                <button
                  type="button"
                  onClick={() => {
                    setMode('create');
                    setConfirmDeleteId(null);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--color-accent)] border-t border-white/5 hover:bg-[var(--color-bg-hover)] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  创建角色
                </button>
              </>
            ) : (
              /* 创建角色视图 */
              <div className="p-3">
                <div className="text-xs text-gray-500 mb-2">输入系统提示词，AI 将按该人设回答</div>
                <textarea
                  value={newRolePrompt}
                  onChange={e => setNewRolePrompt(e.target.value)}
                  placeholder="例：你是一位资深前端工程师，擅长 React 与 TypeScript..."
                  rows={3}
                  className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none resize-none"
                />
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('list');
                      setNewRolePrompt('');
                    }}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateRole}
                    disabled={!newRolePrompt.trim() || creating}
                    className="px-3 py-1.5 text-xs bg-[var(--color-accent)] text-[var(--color-accent-foreground)] rounded-lg hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
                  >
                    {creating ? '创建中...' : '创建角色'}
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body
        )
      )}
    </div>
  );
}
