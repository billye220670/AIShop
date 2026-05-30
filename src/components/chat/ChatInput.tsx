import { useState, useRef, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
import { Paperclip, Square, Send, Plus } from 'lucide-react';
import type { MessageContent } from '../../types';

interface ChatInputProps {
  onSend: (content: string | MessageContent[]) => void;
  isLoading: boolean;
  onStop: () => void;
}

export default function ChatInput({
  onSend,
  isLoading,
  onStop,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
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
    <div className="bg-transparent p-3 md:p-4">
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
    
      {/* Mobile input bar - add button overlay on textarea */}
      <div className="md:hidden relative">
        {/* 加号按钮 - overlay 在输入框左侧 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="absolute left-3.5 bottom-[10px] p-1 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-gray-800 z-10"
          title="添加媒体"
        >
          <Plus className="w-5 h-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
    
        {/* 输入框 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="询问任何问题..."
          className="w-full bg-transparent text-white rounded-full pl-12 pr-12 py-3 resize-none placeholder-gray-500 border border-gray-700 focus:border-purple-500 focus:outline-none max-h-[200px] min-h-[48px]"
          rows={1}
        />

        {/* 发送按钮 - overlay 在输入框右侧 */}
        {(isFocused || text.trim()) && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleSubmit}
            disabled={!text.trim() && images.length === 0}
            className="absolute right-3.5 bottom-[10px] p-1.5 bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 hover:bg-purple-600 text-white transition-colors rounded-full z-10"
            title="发送"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
  
      {/* Desktop input area (traditional layout) */}
      <div className="hidden md:flex items-end gap-3">
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
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 pr-12 resize-none placeholder-gray-500 max-h-[200px] focus:bg-gray-800 focus:outline-none focus:border-purple-500 border border-transparent"
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
            className="p-2.5 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-full transition-colors"
            title="发送"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>


    </div>
  );
}
