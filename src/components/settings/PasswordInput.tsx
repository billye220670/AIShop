/**
 * 密码输入框（带明暗切换），并补齐 Android WebView 的密码框粘贴能力。
 *
 * Chromium WebView 限制：type=password 的输入框长按只弹"自动填充"菜单、
 * 没有"粘贴"项（原生 EditText 密码框是有的）。配套原生层（MainActivity）：
 * 密码框长按被拦截（不弹无用的自动填充菜单），这里长按时弹自定义「粘贴」
 * 菜单读系统剪贴板填入；切到明文（type=text）后放行系统原生菜单，不再干预。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste, Eye, EyeOff } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import { syncFocusedInputType, readClipboardText } from '../../utils/androidBridge';
import Toast from '../common/Toast';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;
const MENU_MARGIN = 8;
const MENU_GAP = 6;

interface PasswordInputProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** 输入框样式（需含 pr-10 预留右侧眼睛按钮位置） */
  className?: string;
}

export default function PasswordInput({ value, onValueChange, placeholder, className }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** 菜单弹出时刻。长按松手瞬间的合成 click 会命中刚覆盖全屏的遮罩，
   *  不吞掉的话菜单弹出即被自己关闭。 */
  const menuOpenedAtRef = useRef(0);

  // 明文/密文切换不走 focus 事件，主动把当前 type 同步给原生层
  useEffect(() => {
    syncFocusedInputType(inputRef.current);
  }, [visible]);

  // 卸载时清理长按计时器
  useEffect(
    () => () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    },
    []
  );

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  };

  const handlePressStart = (e: React.PointerEvent<HTMLInputElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearPressTimer();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    const { clientX, clientY } = e;
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      menuOpenedAtRef.current = Date.now();
      setMenuPos({ x: clientX, y: clientY });
      // 与消息长按菜单一致的键盘级轻触感
      haptic();
    }, LONG_PRESS_MS);
  };

  const handlePressMove = (e: React.PointerEvent<HTMLInputElement>) => {
    const origin = pressOriginRef.current;
    if (!origin || !pressTimerRef.current) return;
    const dx = Math.abs(e.clientX - origin.x);
    const dy = Math.abs(e.clientY - origin.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) clearPressTimer();
  };

  // 菜单弹出后按实际尺寸落位（照抄 MessageBubble 的自适应定位：优先手指
  // 右下方，贴边翻转，最后夹进安全边距）
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menuPos || !el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const offsetX = vv?.offsetLeft ?? 0;
    const offsetY = vv?.offsetTop ?? 0;
    const minX = offsetX + MENU_MARGIN;
    const maxX = offsetX + vw - MENU_MARGIN;
    const minY = offsetY + MENU_MARGIN;
    const maxY = offsetY + vh - MENU_MARGIN;
    const anchorX = menuPos.x + offsetX;
    const anchorY = menuPos.y + offsetY;
    let left = anchorX + MENU_GAP;
    if (left + width > maxX) left = anchorX - MENU_GAP - width;
    left = Math.min(Math.max(left, minX), Math.max(minX, maxX - width));
    let top = anchorY + MENU_GAP;
    if (top + height > maxY) top = Math.max(minY, anchorY - MENU_GAP - height);
    top = Math.min(Math.max(top, minY), Math.max(minY, maxY - height));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  }, [menuPos]);

  const closeMenu = () => setMenuPos(null);

  const handlePaste = async () => {
    closeMenu();
    const el = inputRef.current;
    if (!el) return;
    try {
      // Android 壳走原生剪贴板桥（WebView 的 readText 权限不稳定），其余平台回退 Clipboard API
      const text = await readClipboardText();
      if (!text) {
        setToast({ message: '剪贴板为空', type: 'error' });
        return;
      }
      el.focus();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      // React 受控组件：直接改 value 不会触发 onChange，用原生 setter + input 事件
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const pos = start + text.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* 忽略 */
      }
    } catch {
      setToast({ message: '读取剪贴板失败', type: 'error' });
    }
  };

  const password = !visible;

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          type={password ? 'password' : 'text'}
          value={value}
          onChange={e => onValueChange(e.target.value)}
          placeholder={placeholder}
          className={className}
          onPointerDown={password ? handlePressStart : undefined}
          onPointerMove={password ? handlePressMove : undefined}
          onPointerUp={password ? clearPressTimer : undefined}
          onPointerCancel={password ? clearPressTimer : undefined}
          onPointerLeave={password ? clearPressTimer : undefined}
        />
        <button
          type="button"
          aria-label={visible ? '隐藏密码' : '显示密码'}
          onClick={() => {
            haptic();
            setVisible(v => !v);
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {menuPos && createPortal(
        /* 遮罩：点击关闭，touch-none 防止背景手势穿透 */
        <div
          className="fixed inset-0 z-[150] bg-black/30 context-menu-overlay touch-none overscroll-none"
          onClick={() => {
            // 长按松手后的合成 click target 会被刚覆盖全屏的遮罩接住，
            // 不吞掉的话菜单弹出即被自己关闭
            if (Date.now() - menuOpenedAtRef.current < 500) return;
            closeMenu();
          }}
          onPointerDown={closeMenu}
          onTouchMove={e => e.preventDefault()}
        />,
        document.body
      )}
      {menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
          className="z-[200] w-40 bg-[var(--color-bg-elevated)] border border-white/10 rounded-2xl shadow-2xl py-2 select-none context-menu-pop"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handlePaste}
            className="w-full flex items-center gap-3 px-4 py-3 text-base text-gray-200 active:bg-white/10 hover:bg-white/10 transition-colors"
          >
            <ClipboardPaste className="w-5 h-5 flex-shrink-0" />
            <span>粘贴</span>
          </button>
        </div>,
        document.body
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
