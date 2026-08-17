import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, UserRound, Plus, ChevronDown, Pencil, Wand2, Bot } from 'lucide-react';
import { createRole, updateRole, deleteRole, type RoleData } from '../../db';
import { optimizeRolePrompt } from '../../services/rolePromptOptimizer';
import Toast from './Toast';

interface RoleSelectorProps {
  roles?: RoleData[];
  selectedRoleId?: string;
  onRoleSelect?: (roleId: string) => void;
  /** 角色创建/删除后通知上层重读列表 */
  onRolesChanged?: () => void;
  /** 用户当前选择的聊天模型 id（「优化提示词」使用） */
  selectedModel?: string;
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

/** 下拉内页：角色列表 / 创建角色 / 编辑角色 */
type Mode = 'list' | 'create' | 'edit';

/**
 * 桌面端角色选择器：外壳与 ModelSelector（非 compact 下拉）完全一致——
 * 同款 trigger、fixed 定位下拉、进出动画与关闭逻辑；触发按钮只显示当前
 * 角色 title。下拉内是角色列表（默认角色 + 自定义角色），自定义角色支持
 * 编辑（title + 系统提示词）与两次点击确认删除；创建/编辑表单都带
 * 「优化提示词」按钮，调用用户当前选择的模型重写提示词。
 */
export default function RoleSelector({
  roles = [],
  selectedRoleId = '',
  onRoleSelect = () => {},
  onRolesChanged = () => {},
  selectedModel = '',
}: RoleSelectorProps) {
  const [open, setOpen] = useState(false);
  const [animVisible, setAnimVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  // 创建/编辑表单状态：editingRole 非空 = 编辑模式
  const [editingRole, setEditingRole] = useState<RoleData | null>(null);
  const [roleTitle, setRoleTitle] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [creating, setCreating] = useState(false);
  // 「优化提示词」请求中
  const [optimizing, setOptimizing] = useState(false);
  // 删除角色：第一次点击进入确认态，3 秒内再点才真正删除
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // 优化失败提示
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const deleteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 编辑自动保存：输入防抖 500ms 落库，后退/关闭/卸载时立即落库
  const editSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editSnapshot = useRef<{ id: string; title: string; prompt: string } | null>(null);

  const currentRoleName = selectedRoleId
    ? (roles.find(r => r.id === selectedRoleId)?.name || '自定义角色')
    : 'PortAI';

  // 关闭菜单：在事件回调中同步清除动画状态，避免 effect 内 setState；
  // 编辑中的变更立即落库，关闭即保存
  const close = () => {
    flushEditSave();
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

  // 卸载时清理定时器；编辑中的未落库变更立即保存（组件卸载前最后一次兜底）
  useEffect(() => {
    return () => {
      clearTimeout(deleteTimer.current);
      clearTimeout(toastTimer.current);
      clearTimeout(editSaveTimer.current);
      const snap = editSnapshot.current;
      if (snap && snap.prompt.trim()) {
        void updateRole(snap.id, snap.prompt.trim(), snap.title).catch(() => {});
      }
    };
  }, []);

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

  /** 进入创建视图（从列表底部入口） */
  const openCreate = () => {
    clearTimeout(editSaveTimer.current);
    editSnapshot.current = null;
    setEditingRole(null);
    setRoleTitle('');
    setRolePrompt('');
    setConfirmDeleteId(null);
    setMode('create');
  };

  /** 进入编辑视图：预填当前角色的 title 与提示词 */
  const openEdit = (role: RoleData) => {
    clearTimeout(editSaveTimer.current);
    editSnapshot.current = null;
    setEditingRole(role);
    setRoleTitle(role.name);
    setRolePrompt(role.systemPrompt);
    setConfirmDeleteId(null);
    setMode('edit');
  };

  const goBackToList = () => {
    flushEditSave();
    setMode('list');
    setEditingRole(null);
    setRoleTitle('');
    setRolePrompt('');
    editSnapshot.current = null;
  };

  const handleCreateRole = () => {
    const prompt = rolePrompt.trim();
    if (!prompt || creating) return;
    setCreating(true);
    void createRole(prompt, roleTitle)
      .then(() => {
        setCreating(false);
        onRolesChanged();
        goBackToList();
      })
      .catch(e => {
        console.warn('[roles] 创建角色失败', e);
        setCreating(false);
      });
  };

  // ---- 编辑自动保存：变更先记快照，防抖 500ms 落库；后退/关闭/卸载立即落库 ----

  /** 立即把快照中的编辑内容写入数据库（防抖定时器到点或退出编辑时调用） */
  const flushEditSave = useCallback(() => {
    clearTimeout(editSaveTimer.current);
    const snap = editSnapshot.current;
    if (!snap) return;
    editSnapshot.current = null;
    const prompt = snap.prompt.trim();
    if (!prompt) return; // 提示词被清空时跳过，保留上一次已保存内容
    void updateRole(snap.id, prompt, snap.title)
      .then(() => onRolesChanged())
      .catch(e => console.warn('[roles] 自动保存失败', e));
  }, [onRolesChanged]);

  /** 输入变更：更新表单状态；编辑模式下记录快照并防抖保存 */
  const handleFormChange = (title: string, prompt: string) => {
    setRoleTitle(title);
    setRolePrompt(prompt);
    if (!editingRole) return;
    editSnapshot.current = { id: editingRole.id, title, prompt };
    clearTimeout(editSaveTimer.current);
    editSaveTimer.current = setTimeout(flushEditSave, 500);
  };

  /** 「优化提示词」：用用户当前选择的模型重写系统提示词，成功回填文本框 */
  const handleOptimize = () => {
    const prompt = rolePrompt.trim();
    if (!prompt || optimizing) return;
    if (!selectedModel) {
      setToastMessage('请先在聊天中选择模型，再优化提示词');
      setShowToast(true);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setShowToast(false), 3000);
      return;
    }
    setOptimizing(true);
    void optimizeRolePrompt({ userText: prompt, model: selectedModel })
      .then(optimized => {
        if (optimized) {
          // 回填并同步触发编辑模式的自动保存
          handleFormChange(roleTitle, optimized);
        } else {
          setToastMessage('优化失败，请检查模型配置后重试');
          setShowToast(true);
          clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setShowToast(false), 3000);
        }
      })
      .finally(() => setOptimizing(false));
  };

  // 渲染单个角色项（编辑 + 两次点击确认删除）
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
          onClick={() => openEdit(role)}
          title="编辑角色"
          className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
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

  // 创建/编辑共用表单视图：title + 系统提示词 + 优化按钮（编辑模式无保存按钮，变更自动落库）
  const renderFormView = () => (
    <div className="p-3">
      <input
        value={roleTitle}
        onChange={e => handleFormChange(e.target.value, rolePrompt)}
        placeholder="角色标题（留空自动取提示词首行）"
        className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none mb-2"
      />
      <textarea
        value={rolePrompt}
        onChange={e => handleFormChange(roleTitle, e.target.value)}
        placeholder="例：你是一位资深前端工程师，擅长 React 与 TypeScript..."
        rows={4}
        className="w-full bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-[var(--color-accent)] focus:outline-none resize-none"
      />
      <div className="flex items-center justify-between mt-2 gap-2">
        <button
          type="button"
          onClick={handleOptimize}
          disabled={!rolePrompt.trim() || optimizing}
          title="让当前选择的模型分析你的描述，优化成高质量系统提示词"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-accent)] border border-[var(--color-accent)]/40 rounded-lg hover:bg-[var(--color-accent)]/10 disabled:opacity-40 transition-colors"
        >
          <Wand2 className="w-3.5 h-3.5" />
          {optimizing ? '优化中...' : '优化提示词'}
        </button>
        {editingRole ? (
          /* 编辑模式：无保存按钮，修改即自动保存，返回即完成 */
          <button
            type="button"
            onClick={goBackToList}
            className="px-3 py-1.5 text-xs bg-[var(--color-accent)] text-[var(--color-accent-foreground)] rounded-lg hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            完成
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBackToList}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreateRole}
              disabled={!rolePrompt.trim() || creating}
              className="px-3 py-1.5 text-xs bg-[var(--color-accent)] text-[var(--color-accent-foreground)] rounded-lg hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
            >
              {creating ? '创建中...' : '创建角色'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="切换角色"
        className="flex items-center gap-2 text-sm cursor-pointer rounded-full h-9 bg-[var(--color-bg-button)]/80 px-4 hover:bg-[var(--color-bg-button)] transition-colors"
      >
        {/* 按钮只显示当前角色的 title */}
        <span className="whitespace-nowrap max-w-28 overflow-hidden text-ellipsis">{currentRoleName}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
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
                  onClick={openCreate}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--color-accent)] border-t border-white/5 hover:bg-[var(--color-bg-hover)] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  创建角色
                </button>
              </>
            ) : (
              /* 创建/编辑角色表单 */
              <div className="overflow-y-auto h-full max-h-[inherit]">
                <div className="px-3 pt-3 pb-1 text-xs text-gray-500">
                  {editingRole ? '编辑角色：修改自动保存，返回即完成' : '输入角色描述，AI 将按该人设回答'}
                </div>
                {renderFormView()}
              </div>
            )}
          </div>,
          document.body
        )
      )}

      {showToast && (
        <Toast
          message={toastMessage}
          type="error"
          onClose={() => setShowToast(false)}
        />
      )}
    </div>
  );
}
