import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, MessageContent } from '../../types';

interface MessageBubbleProps {
  message: Message;
  onSuggestionClick?: (text: string) => void;
  showSuggestions?: boolean;
}

export default function MessageBubble({ message, onSuggestionClick, showSuggestions }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  const renderContent = () => {
    if (typeof message.content === 'string') {
      if (isUser) {
        return <p className="whitespace-pre-wrap">{message.content}</p>;
      }
      return (
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-gray-100 prose-p:text-gray-200 prose-strong:text-white prose-code:text-blue-300 prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-a:text-blue-400 prose-li:text-gray-200 prose-blockquote:border-gray-600 prose-blockquote:text-gray-300 prose-th:text-gray-200 prose-td:text-gray-300 prose-hr:border-gray-700">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5" />
          )}
        </div>
      );
    }

    // Multi-part content (text + images)
    const parts = message.content as MessageContent[];
    return (
      <div className="space-y-2">
        {parts.map((part, idx) => {
          if (part.type === 'text' && part.text) {
            return <p key={idx} className="whitespace-pre-wrap">{part.text}</p>;
          }
          if (part.type === 'image_url' && part.image_url) {
            return (
              <img
                key={idx}
                src={part.image_url.url}
                alt="uploaded"
                className="max-w-xs rounded-lg"
              />
            );
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-100 border border-gray-700'
        }`}
      >
        {!isUser && (
          <div className="text-xs text-gray-400 mb-1 font-medium">AI</div>
        )}
        {!isUser && message.webSearched && (
          <div className="flex items-center gap-1.5 text-xs text-green-400 mb-2">
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
            <span>已联网搜索</span>
          </div>
        )}
        {!isUser && message.webSearchFailed && (
          <div className="flex items-center gap-1.5 text-xs text-yellow-400 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span>联网搜索失败，以下回答未参考网络信息</span>
          </div>
        )}
        {renderContent()}
        {!isUser &&
          message.searchResults &&
          message.searchResults.length > 0 &&
          !message.isStreaming && (
            <div className="mt-3 pt-2 border-t border-gray-700">
              <div className="text-xs text-gray-400 mb-1.5">参考来源：</div>
              <div className="flex flex-wrap gap-1.5">
                {message.searchResults.slice(0, 5).map((source, idx) => (
                  <a
                    key={idx}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-0.5 bg-gray-700/50 hover:bg-gray-600/50 text-blue-400 hover:text-blue-300 rounded border border-gray-600 transition-colors truncate max-w-[200px]"
                    title={source.name}
                  >
                    {source.siteName || source.name}
                  </a>
                ))}
              </div>
            </div>
          )}
        {!isUser &&
          showSuggestions &&
          message.suggestions &&
          message.suggestions.length > 0 &&
          !message.isStreaming && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-700">
              {message.suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => onSuggestionClick?.(suggestion)}
                  className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-full transition-colors border border-gray-600 hover:border-gray-500"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
