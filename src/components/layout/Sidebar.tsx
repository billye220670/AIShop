import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Download, Pencil, Trash2, MessageSquare, Star, X, Check, MoreHorizontal, EyeOff, Lock } from 'lucide-react';
import PinyinMatch from 'pinyin-match';
import type { Conversation } from '../../types';
import ConfirmModal from '../common/ConfirmModal';
import PromptModal from '../common/PromptModal';
import { haptic } from '../../utils/haptics';
import { useDeviceMode } from '../../platform/useDeviceMode';
import { hasAnyMessage, lastMessagePreviewOf } from '../../utils/conversationView';
import { exportSingleConversation } from '../../services/backup';

export interface SidebarProps {
  conversations?: Conversation[];
  activeConversationId?: string;
  onSwitchConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  onDeleteConversations?: (ids: string[]) => void;
  onToggleConversationFavorite?: (id: string) => void;
  onToggleConversationHidden?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  /** BYOC 同步完成后重新加载会话列表（由 App 层提供 useChat 的重载能力） */
  onRefreshConversations?: () => Promise<void> | void;
}

export const SIDEBAR_WIDTH = 360;
export const COLLAPSED_WIDTH = 60;
export const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

type FilterMode = 'all' | 'favorite' | 'hidden';

export default function Sidebar({
  conversations,
  activeConversationId,
  onSwitchConversation,
  onDeleteConversation,
  onDeleteConversations,
  onToggleConversationFavorite,
  onToggleConversationHidden,
  onRenameConversation,
}: SidebarProps) {
  const [historySearch, setHistorySearch] = useState('');
  // 桌面形态（Electron/PC 浏览器）：禁用长按，改悬停三点按钮呼出菜单；移动端保留长按
  const isDesktop = useDeviceMode() === 'desktop';
  // 三点菜单状态
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // 重命名弹窗状态（弹窗内部自行管理输入值）
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  // 删除确认状态（单个 / 批量）
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  // 筛选模式：所有 / 收藏
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  // 批量选择模式
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- 点击后延迟切换 ---
  /** 点击项先本地高亮，短暂停顿让用户看到选中反馈，再真正切换并收起面板 */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const SELECT_FEEDBACK_MS = 160;
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectConversation = (id: string) => {
    if (selectTimerRef.current) return; // 已有待处理的切换，忽略连点
    setPendingId(id);
    selectTimerRef.current = setTimeout(() => {
      selectTimerRef.current = null;
      setPendingId(null);
      onSwitchConversation?.(id);
    }, SELECT_FEEDBACK_MS);
  };

  useEffect(() => () => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
  }, []);

  // --- 长按唤出上下文菜单 ---
  const LONG_PRESS_MS = 450;
  /** 超过这个位移视为滚动，取消长按 */
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** 长按已触发，记录时间戳用于吞掉紧随其后的合成 click（避免顺带切换会话）。
   *  用时间戳而不是布尔：长按后的合成 click 往往不落在列表项上（遮罩/弹窗
   *  接住），布尔标志会残留到下一次普通点击，把那次点击误吞成"没反应"。 */
  const suppressClickRef = useRef(0);
  const SUPPRESS_WINDOW_MS = 500;
  /**
   * 菜单锚点 = 手指按下的视口坐标。
   * 菜单本身要 portal 到 body 才能定位，不能再沿用列表项的 absolute 定位。
   */
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 菜单弹出时刻。长按松手瞬间 Chrome 会把合成 click 派发给刚覆盖全屏的
   *  遮罩（target 判定发生在 pointerup，此时遮罩已压住手指），若遮罩 onClick
   *  立刻执行，菜单会被自己"点外关闭"——弹出后短暂窗口内的 click 必须吞掉。 */
  const menuOpenedAtRef = useRef(0);

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  };

  const handlePressStart = (id: string, e: React.PointerEvent) => {
    // 只响应主键/触摸，忽略右键与多指
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearPressTimer();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    const { clientX, clientY } = e;
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      suppressClickRef.current = Date.now();
      menuOpenedAtRef.current = Date.now();
      setMenuPos({ x: clientX, y: clientY });
      setMenuOpenId(id);
      // 长按已选中的文本会残留，主动清掉
      window.getSelection?.()?.removeAllRanges();
      // 与点击汉堡菜单图标一致的轻触感（键盘级），菜单弹出瞬间触发
      haptic();
    }, LONG_PRESS_MS);
  };

  const handlePressMove = (e: React.PointerEvent) => {
    const origin = pressOriginRef.current;
    if (!origin || !pressTimerRef.current) return;
    const dx = Math.abs(e.clientX - origin.x);
    const dy = Math.abs(e.clientY - origin.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
      clearPressTimer();
    }
  };

  useEffect(() => () => clearPressTimer(), []);

  /**
   * 菜单开出来后按实际尺寸自适应位置：优先在手指右下方展开，
   * 贴到视口边缘就翻到另一侧，最后再统一夹进安全边距内。
   * 用 useLayoutEffect 在绘制前落位，避免先闪一下错位。
   *
   * 之前菜单是列表项内部的 `absolute right-3 top-1/2`：列表容器是
   * overflow-y-auto，项目本身又套在带 translateX 的侧边栏抽屉里，
   * 菜单一旦超出列表可视区域底部就被裁掉。这里改成 portal 到 body +
   * fixed 定位，彻底脱离这些会裁剪内容的祖先。
   */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menuOpenId || !el || !menuPos) return;
    const MARGIN = 8;
    const GAP = 6;

    // 高度得先解开：菜单可能已经被上一次的 maxHeight 压过，
    // 不清掉就会一直沿用那个更小的值。
    el.style.maxHeight = '';
    el.style.overflowY = '';
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    /* 移动端必须用 visualViewport：window.innerHeight 是"大视口"，
       含浏览器工具栏占掉的那一条，按它算出来的底边在屏幕外，
       菜单就被截断。visualViewport 才是真正可见的那块。 */
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const offsetX = vv?.offsetLeft ?? 0;
    const offsetY = vv?.offsetTop ?? 0;
    const minX = offsetX + MARGIN;
    const maxX = offsetX + vw - MARGIN;
    const minY = offsetY + MARGIN;
    const maxY = offsetY + vh - MARGIN;

    const anchorX = menuPos.x + offsetX;
    const anchorY = menuPos.y + offsetY;

    let left = anchorX + GAP;
    if (left + width > maxX) left = anchorX - GAP - width; // 右侧放不下 → 翻到左边
    left = Math.min(Math.max(left, minX), Math.max(minX, maxX - width));

    // 上下都塞不进整个菜单时，选空间更大的一侧并让它内部滚动，
    // 而不是硬塞出去被截断
    let top = anchorY + GAP;
    const spaceBelow = maxY - (anchorY + GAP);
    const spaceAbove = anchorY - GAP - minY;
    if (height > spaceBelow) {
      if (height <= spaceAbove) {
        top = anchorY - GAP - height; // 上方放得下 → 翻到上边
      } else {
        const usable = Math.max(spaceBelow, spaceAbove);
        el.style.maxHeight = `${Math.max(120, usable)}px`;
        el.style.overflowY = 'auto';
        top = spaceAbove > spaceBelow ? minY : anchorY + GAP;
      }
    }
    const finalHeight = el.offsetHeight;
    top = Math.min(Math.max(top, minY), Math.max(minY, maxY - finalHeight));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transformOrigin = `${top > anchorY ? 'top' : 'bottom'} ${
      left >= anchorX ? 'left' : 'right'
    }`;
    el.style.visibility = 'visible';
  }, [menuOpenId, menuPos]);

  // 点击/触摸外部关闭菜单
  useEffect(() => {
    if (!menuOpenId) return;
    // 长按松手后的合成 click 会命中刚覆盖全屏的遮罩并继续冒泡到这里，
    // 必须吞掉弹出后短暂窗口内的 click（合成 click 在松手后几毫秒内派发），
    // 否则菜单会被"点外关闭"逻辑自己关掉；pointerdown 是真实触摸无需过滤
    const handleClick = () => {
      if (Date.now() - menuOpenedAtRef.current < 500) return;
      setMenuOpenId(null);
    };
    const handlePointerDown = () => setMenuOpenId(null);
    // 捕获阶段监听，保证在菜单项自身的 stopPropagation 之外也能关闭
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpenId]);

  // 菜单弹出后锁住背后的历史列表滚动。
  // 长按是在手指没抬起时触发的，此刻原生滚动手势已经"归属"给了列表容器，
  // 后续 touchmove 由合成器线程直接滚，JS 拦不住——除非把容器本身变成不可滚。
  // 所以直接改 overflow，并把 scrollTop 还原（overflow 切换会让浏览器夹一次位置）。
  // 与 MessageBubble 锁定消息容器（data-messages-container）的方案一致。
  const historyListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpenId) return;
    const scroller = historyListRef.current;
    if (!scroller) return;
    const prevOverflow = scroller.style.overflowY;
    const prevTouch = scroller.style.touchAction;
    const frozenTop = scroller.scrollTop;
    scroller.style.overflowY = 'hidden';
    scroller.style.touchAction = 'none';
    if (scroller.scrollTop !== frozenTop) scroller.scrollTop = frozenTop;
    return () => {
      scroller.style.overflowY = prevOverflow;
      scroller.style.touchAction = prevTouch;
      scroller.scrollTop = frozenTop;
    };
  }, [menuOpenId]);

  // Filtered conversations (排除空会话)
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    // 不能只看 messages.length：会话消息是按需加载的，未打开过的会话
    // messages 为空数组，按长度过滤会让全部历史会话消失。
    // 也不能只看 totalMessageCount：它是 hydrate 时的快照，之后新发的消息不计入。
    let nonEmpty = conversations.filter(conv => hasAnyMessage(conv));
    if (filterMode === 'hidden') {
      // 已隐藏视图：只显示隐藏的会话
      nonEmpty = nonEmpty.filter(conv => conv.isHidden);
    } else {
      // 主列表（所有/收藏）不显示隐藏会话
      nonEmpty = nonEmpty.filter(conv => !conv.isHidden);
      if (filterMode === 'favorite') {
        nonEmpty = nonEmpty.filter(conv => conv.isFavorite);
      }
    }
    const keyword = historySearch.trim();
    if (!keyword) return nonEmpty;
    return nonEmpty.filter(conv => {
      if (conv.title.toLowerCase().includes(keyword.toLowerCase())) return true;
      const match = PinyinMatch.match(conv.title, keyword);
      return match !== false;
    });
  }, [conversations, historySearch, filterMode]);

  // 时间分组逻辑
  const groupedConversations = useMemo(() => {
    if (!filteredConversations.length) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const groups: { label: string; items: typeof filteredConversations }[] = [
      { label: '今天', items: [] },
      { label: '昨天', items: [] },
      { label: '本月', items: [] },
      { label: '更早', items: [] },
    ];

    for (const conv of filteredConversations) {
      const t = conv.updatedAt;
      if (t >= todayStart) groups[0].items.push(conv);
      else if (t >= yesterdayStart) groups[1].items.push(conv);
      else if (t >= monthStart) groups[2].items.push(conv);
      else groups[3].items.push(conv);
    }

    return groups.filter(g => g.items.length > 0);
  }, [filteredConversations]);

  const getLastMessagePreview = lastMessagePreviewOf;

  // 导出会话为 JSON
  const exportConversation = (conv: Conversation) => {
    void exportSingleConversation(conv.id, conv.title).catch(e =>
      console.error('[Sidebar] 导出会话失败', e)
    );
  };

  // 重命名：菜单项点击后弹出输入弹窗
  const enterEdit = (conv: Conversation) => {
    setMenuOpenId(null);
    setRenameTarget(conv);
  };

  // 当前呼出菜单对应的会话（菜单已 portal 到 body，不再挂在列表项下面）
  const menuConv = menuOpenId ? conversations?.find(c => c.id === menuOpenId) ?? null : null;

  return (
    <aside className="h-full bg-transparent flex flex-col overflow-hidden">
      {/* 搜索框
          外层 54px 对齐 TopNavBar 行高：py-2(16) + 最高子元素 ModelSelector 38px
          （text-sm 20 + py-2 16 + border 2）；汉堡按钮 36px 在该行内居中。
          配合 items-center，搜索框与右侧汉堡图标处于同一水平中线 */}
      <div className="px-4 h-[54px] flex items-center shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
            placeholder="搜索对话"
            className="w-full h-10 bg-[var(--color-bg-primary)] rounded-full pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:outline-none"
          />
        </div>
      </div>

      {/* 操作按钮栏：状态切换（所有/收藏） + 删除入口 / 批量操作（取消/删除） */}
      <div className="px-4 py-3 flex items-center justify-between shrink-0">
        {selectMode ? (
          <>
            <button
              onClick={exitSelectMode}
              className="p-2.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="取消"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (selectedIds.size > 0) setBatchDeleteConfirm(true);
              }}
              disabled={selectedIds.size === 0}
              className={`p-2.5 rounded-full transition-colors ${
                selectedIds.size === 0
                  ? 'text-red-400/40 cursor-default'
                  : 'text-red-400 hover:bg-red-500/10'
              }`}
              title="删除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilterMode('all')}
                className={`p-2.5 rounded-full transition-colors ${
                  filterMode === 'all'
                    ? 'bg-[var(--color-accent)] text-black'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
                title="所有"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              <button
                onClick={() => setFilterMode('favorite')}
                className={`p-2.5 rounded-full transition-colors ${
                  filterMode === 'favorite'
                    ? 'bg-[var(--color-accent)] text-black'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
                title="收藏"
              >
                <Star className="w-4 h-4" />
              </button>
              <button
                onClick={() => setFilterMode('hidden')}
                className={`p-2.5 rounded-full transition-colors ${
                  filterMode === 'hidden'
                    ? 'bg-[var(--color-accent)] text-black'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
                title="已隐藏"
              >
                <Lock className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => setSelectMode(true)}
              className="p-2.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="批量删除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* 会话列表 */}
      <div ref={historyListRef} className="flex-1 overflow-y-auto overflow-x-visible px-2 pt-2">
        {filteredConversations.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            {filterMode === 'hidden' ? '暂无隐藏的会话' : historySearch ? '无匹配结果' : null}
          </div>
        )}
        {groupedConversations.map(group => (
          <div key={group.label}>
            <div className="px-2 pt-3 pb-1.5 text-xs text-gray-500 font-medium">{group.label}</div>
            {group.items.map(conv => {
              // pendingId 让高亮在真正切换前就先落到被点的项上
              const isActive = pendingId ? conv.id === pendingId : conv.id === activeConversationId;
              const isMenuOpen = menuOpenId === conv.id;
              const isChecked = selectedIds.has(conv.id);
              return (
                <div
                  key={conv.id}
                  className={`group relative w-full text-left px-3 py-3 pb-4 rounded-2xl mb-0.5 transition-colors cursor-pointer select-none [-webkit-touch-callout:none] flex items-start gap-2 ${
                    isActive && !selectMode
                      ? 'bg-[var(--color-accent-soft)]'
                      : isMenuOpen
                        ? 'bg-white/10'
                        : 'hover:bg-white/5'
                  }`}
                  onPointerDown={e => { if (!selectMode && !isDesktop) handlePressStart(conv.id, e); }}
                  onPointerMove={handlePressMove}
                  onPointerUp={clearPressTimer}
                  onPointerCancel={clearPressTimer}
                  onPointerLeave={clearPressTimer}
                  // 长按在部分浏览器仍会尝试弹出原生菜单/选词，这里一并拦掉
                  onContextMenu={e => e.preventDefault()}
                  onClick={e => {
                    if (Date.now() - suppressClickRef.current < SUPPRESS_WINDOW_MS) {
                      suppressClickRef.current = 0;
                      // 长按松手后的合成 click 会继续冒泡到 document，被「点击外部
                      // 关闭菜单」的监听器接住，把刚弹出的菜单立刻关掉（菜单存活
                      // 时间只有松手到 click 派发这几毫秒）。必须在此掐断冒泡。
                      e.stopPropagation();
                      return;
                    }
                    if (selectMode) {
                      toggleSelected(conv.id);
                      return;
                    }
                    selectConversation(conv.id);
                  }}
                >
                  {/* 批量选择模式下的复选框，与标题行水平对齐 */}
                  {selectMode && (
                    <div
                      className={`mt-0.5 mr-1 w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${
                        isChecked
                          ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                          : 'border-gray-500'
                      }`}
                    >
                      {isChecked && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {/* 标题行 */}
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 min-w-0 text-base font-bold text-white truncate">
                        {conv.title}
                      </div>
                      {/* 桌面端：悬停显示三点按钮，点击在按钮位置展开上下文菜单；移动端保留长按不渲染 */}
                      {isDesktop && !selectMode && (
                        <button
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            // 锚点取按钮左下角：菜单在按钮正下方左对齐展开（面板靠右，不向右溢出）
                            setMenuPos({ x: rect.left, y: rect.bottom });
                            setMenuOpenId(conv.id);
                          }}
                          className={`p-1.5 -mr-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 ${
                            isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                          title="更多操作"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* 预览文本 */}
                    <div className="text-xs text-gray-400 mt-1.5 line-clamp-2">
                      {getLastMessagePreview(conv)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 长按呼出上下文菜单：遮罩 + 菜单本体都 portal 到 body。
          原先菜单挂在列表项下面用 absolute 定位，会被 overflow-y-auto 的列表容器、
          以及外层带 translateX 的侧边栏抽屉裁掉底部；portal 出去后彻底脱离这些
          会裁剪内容的祖先，位置改用 useLayoutEffect 按手指坐标现算。 */}
      {menuOpenId && createPortal(
        <div
          className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay touch-none overscroll-none"
          onClick={() => {
            // 长按松手后的合成 click target 会被刚覆盖全屏的遮罩接住（pointerup
            // 时遮罩已压住手指），这里不吞掉的话菜单弹出即被自己关闭
            if (Date.now() - menuOpenedAtRef.current < 500) return;
            setMenuOpenId(null);
          }}
          onPointerDown={() => setMenuOpenId(null)}
          onTouchMove={e => e.preventDefault()}
        />,
        document.body
      )}
      {menuOpenId && menuConv && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
          className="z-[200] w-48 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          {/* iOS 长按手势结束后首次 tap 的合成 click 会被 WebKit 吞掉，
              菜单项必须用 pointerup 触发（Pointer 事件不受抑制），onClick 保留给键盘兜底；
              pointerup 触发后菜单随即卸载，click 不会再派发到按钮，不会重复执行 */}
          <button
            onClick={() => {
              exportConversation(menuConv);
              setMenuOpenId(null);
            }}
            onPointerUp={e => {
              if (e.button !== 0) return;
              exportConversation(menuConv);
              setMenuOpenId(null);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
          >
            <Download className="w-5 h-5 flex-shrink-0" />
            <span>导出</span>
          </button>
          <button
            onClick={() => enterEdit(menuConv)}
            onPointerUp={e => {
              if (e.button !== 0) return;
              enterEdit(menuConv);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
          >
            <Pencil className="w-5 h-5 flex-shrink-0" />
            <span>编辑标题</span>
          </button>
          <button
            onClick={() => {
              onToggleConversationFavorite?.(menuConv.id);
              setMenuOpenId(null);
            }}
            onPointerUp={e => {
              if (e.button !== 0) return;
              onToggleConversationFavorite?.(menuConv.id);
              setMenuOpenId(null);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
          >
            <Star className="w-5 h-5 flex-shrink-0" fill={menuConv.isFavorite ? 'currentColor' : 'none'} />
            <span>{menuConv.isFavorite ? '取消收藏' : '收藏'}</span>
          </button>
          <button
            onClick={() => {
              onToggleConversationHidden?.(menuConv.id);
              setMenuOpenId(null);
            }}
            onPointerUp={e => {
              if (e.button !== 0) return;
              onToggleConversationHidden?.(menuConv.id);
              setMenuOpenId(null);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
          >
            <EyeOff className="w-5 h-5 flex-shrink-0" />
            <span>{menuConv.isHidden ? '取消隐藏' : '隐藏'}</span>
          </button>
          <button
            onClick={() => {
              setDeleteTarget(menuConv.id);
              setMenuOpenId(null);
            }}
            onPointerUp={e => {
              if (e.button !== 0) return;
              setDeleteTarget(menuConv.id);
              setMenuOpenId(null);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-base text-red-400 active:bg-white/10 hover:bg-white/10 transition-colors"
          >
            <Trash2 className="w-5 h-5 flex-shrink-0" />
            <span>删除</span>
          </button>
        </div>,
        document.body
      )}

      {/* 底部版本号 */}
      <div className="px-4 pb-3 pt-2 mt-auto">
        <p className="text-xs text-gray-500 text-center">
          v{__APP_VERSION__}
        </p>
      </div>

      {/* 重命名弹窗 */}
      <PromptModal
        open={renameTarget !== null}
        title="编辑标题"
        initialValue={renameTarget?.title ?? ''}
        placeholder="新标题"
        confirmText="保存"
        cancelText="取消"
        maxLength={50}
        onConfirm={value => {
          if (renameTarget) onRenameConversation?.(renameTarget.id, value);
          setRenameTarget(null);
        }}
        onCancel={() => setRenameTarget(null)}
      />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="删除会话"
        message="确定要删除这个会话吗？删除后无法恢复。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) onDeleteConversation?.(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 批量删除确认弹窗 */}
      <ConfirmModal
        open={batchDeleteConfirm}
        title="删除会话"
        message={`确定要删除选中的 ${selectedIds.size} 个会话吗？删除后无法恢复。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          onDeleteConversations?.(Array.from(selectedIds));
          setBatchDeleteConfirm(false);
          exitSelectMode();
        }}
        onCancel={() => setBatchDeleteConfirm(false)}
      />
    </aside>
  );
}
