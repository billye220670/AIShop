import { useState, useRef, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
import { Paperclip, Square, Send, Globe } from 'lucide-react';
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
          <Paperclip className="w-5 h-5" />
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
            <Square className="w-5 h-5" fill="currentColor" strokeWidth={0} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!text.trim() && images.length === 0}
            className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl transition-colors"
            title="发送"
          >
            <Send className="w-5 h-5" />
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
          <Globe className="w-3.5 h-3.5" />
          <span>联网</span>
        </button>
      </div>
    </div>
  );
}
