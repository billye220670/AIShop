import { useState, useRef, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
import ModelSelector from '../common/ModelSelector';
import { CHAT_MODELS } from '../../config/models';
import type { MessageContent } from '../../types';

interface ChatInputProps {
  onSend: (content: string | MessageContent[]) => void;
  isLoading: boolean;
  onStop: () => void;
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  webSearchEnabled: boolean;
  onWebSearchToggle: (enabled: boolean) => void;
}

export default function ChatInput({
  onSend,
  isLoading,
  onStop,
  selectedModel,
  onModelChange,
  webSearchEnabled,
  onWebSearchToggle,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmedText = text.trim();
    if (!trimmedText && images.length === 0) return;
    if (isLoading) return;

    if (images.length > 0) {
      const content: MessageContent[] = [];
      if (trimmedText) {
        content.push({ type: 'text', text: trimmedText });
      }
      images.forEach(img => {
        content.push({ type: 'image_url', image_url: { url: img } });
      });
      onSend(content);
    } else {
      onSend(trimmedText);
    }

    setText('');
    setImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const base64 = ev.target?.result as string;
            setImages(prev => [...prev, base64]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64 = ev.target?.result as string;
          setImages(prev => [...prev, base64]);
        };
        reader.readAsDataURL(file);
      }
    });
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-gray-700 bg-gray-900 p-4">
      {/* Image preview */}
      {images.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-600" />
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-3">
        {/* File upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
          title="上传图片"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 pr-12 resize-none border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 max-h-[200px]"
            rows={1}
          />
        </div>

        {/* Send / Stop button */}
        {isLoading ? (
          <button
            onClick={onStop}
            className="p-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors"
            title="停止生成"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!text.trim() && images.length === 0}
            className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl transition-colors"
            title="发送"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Model selector */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-gray-400 hidden md:inline">模型:</span>
        <div className="hidden md:inline-flex">
          <ModelSelector
            models={CHAT_MODELS}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
          />
        </div>
        <button
          onClick={() => onWebSearchToggle(!webSearchEnabled)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
            webSearchEnabled
              ? 'bg-green-600/20 border-green-500 text-green-400'
              : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
          }`}
          title="联网搜索"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
            />
          </svg>
          <span>联网</span>
        </button>
      </div>
    </div>
  );
}
