import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import PinyinMatch from 'pinyin-match';
import type { Conversation } from '../../types';
import ConfirmModal from '../common/ConfirmModal';

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export default function ConversationList({
  conversations,
  activeId,
  onSwitch,
  onNew,
  onDelete,
  onRename,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredConversations = useMemo(() => {
    // 过滤掉没有消息的空会话（无论标题是什么）
    const nonEmpty = conversations.filter(conv => conv.messages && conv.messages.length > 0);
    const keyword = searchText.trim();
    if (!keyword) return nonEmpty;
    return nonEmpty.filter(conv => {
      if (conv.title.toLowerCase().includes(keyword.toLowerCase())) return true;
      const match = PinyinMatch.match(conv.title, keyword);
      return match !== false;
    });
  }, [conversations, searchText]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const enterEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditText(conv.title);
  };

  const commitEdit = (id: string) => {
    const trimmed = editText.trim();
    if (trimmed) {
      onRename(id, trimmed);
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 新建会话按钮 */}
      <button
        onClick={onNew}
        className="mx-3 mb-3 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        <MessageSquarePlus className="w-4 h-4" />
        <span>新对话</span>
      </button>

      {/* 搜索框 */}
      <div className="mx-3 mb-2">
        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="搜索对话..."
          className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:outline-none focus:border-blue-500 placeholder-gray-500"
        />
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto space-y-1 px-2 pb-2">
        {filteredConversations.length === 0 && searchText && (
          <div className="text-center text-gray-500 text-xs py-4">无匹配结果</div>
        )}
        {filteredConversations.map(conv => {
          const isEditing = editingId === conv.id;
          return (
            <div
              key={conv.id}
              onClick={() => {
                if (!isEditing) onSwitch(conv.id);
              }}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                conv.id === activeId
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onBlur={() => commitEdit(conv.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit(conv.id);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  maxLength={50}
                  className="flex-1 min-w-0 bg-gray-800 text-white text-sm px-2 py-0.5 rounded border border-blue-500 outline-none"
                />
              ) : (
                <span
                  className="flex-1 text-sm truncate"
                  onDoubleClick={e => {
                    e.stopPropagation();
                    enterEdit(conv);
                  }}
                  title="双击重命名"
                >
                  {conv.title}
                </span>
              )}
              {!isEditing && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setDeleteTarget(conv.id);
                  }}
                  className="md:opacity-0 md:group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity p-0.5 inline-flex"
                  title="删除会话"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title="删除会话"
        message="确定要删除这个会话吗？删除后无法恢复。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
