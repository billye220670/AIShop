import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ACCESS_CODE_UNAUTHORIZED_EVENT,
  clearAccessCode,
  probeAccessCode,
  setAccessCode,
  verifyAccessCode,
} from '../../services/accessCode';

type GateStatus = 'checking' | 'locked' | 'unlocked';

interface AccessGateProps {
  children: ReactNode;
}

/**
 * 访问码登录闸门：
 *  - 启动时探测 /api/verify，若服务端未配置访问码或本地已存有效码则直接放行
 *  - 否则展示登录界面，输入正确后写入 localStorage 并解锁
 *  - 监听全局 unauthorized 事件，遇 401 自动锁回登录界面
 */
export default function AccessGate({ children }: AccessGateProps) {
  const [status, setStatus] = useState<GateStatus>('checking');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    probeAccessCode().then((r) => {
      if (cancelled) return;
      if (!r.required || r.valid) {
        setStatus('unlocked');
      } else {
        setStatus('locked');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      setStatus('locked');
      setInput('');
      setError('登录已失效，请重新输入访问码');
    };
    window.addEventListener(ACCESS_CODE_UNAUTHORIZED_EVENT, handler);
    return () => {
      window.removeEventListener(ACCESS_CODE_UNAUTHORIZED_EVENT, handler);
    };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = input.trim();
    if (!code) {
      setError('请输入访问码');
      return;
    }
    setSubmitting(true);
    setError('');
    const ok = await verifyAccessCode(code);
    setSubmitting(false);
    if (ok) {
      setAccessCode(code);
      setStatus('unlocked');
      setInput('');
    } else {
      clearAccessCode();
      setError('访问码不正确');
    }
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-300">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span>正在校验访问权限...</span>
        </div>
      </div>
    );
  }

  if (status === 'locked') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
        <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-xl border border-gray-700 p-8">
          <div className="mb-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6 text-blue-400"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-100">AIShop 访问限制</h1>
            <p className="mt-2 text-sm text-gray-400">
              此实例需要访问码才能使用，请向站点所有者获取
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="access-code"
                className="block text-sm font-medium text-gray-300 mb-1.5"
              >
                访问码
              </label>
              <input
                id="access-code"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={submitting}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                placeholder="请输入访问码"
              />
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? '验证中...' : '解锁访问'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
