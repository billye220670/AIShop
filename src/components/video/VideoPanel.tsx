import { useState } from 'react';
import { Paperclip, Send } from 'lucide-react';

interface VideoItem {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
}

export default function VideoPanel() {
  const [videos] = useState<VideoItem[]>([]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-gray-900/50">
        <h2 className="text-lg font-semibold">AI 视频生成</h2>
        <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded">即将上线</span>
      </div>

      {/* Video wall */}
      <div className="flex-1 overflow-y-auto p-6">
        {videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-5xl mb-4">🎬</div>
            <p className="text-lg">视频生成模式</p>
            <p className="text-sm mt-2">此功能即将上线，敬请期待</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {videos.map((video) => (
              <div key={video.id} className="relative group rounded-xl overflow-hidden bg-gray-800 border border-gray-700">
                <video src={video.url} className="w-full aspect-video object-cover" controls />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-xs text-white truncate">{video.prompt}</p>
                  <button className="mt-1 text-xs text-blue-400 hover:text-blue-300">
                    ⬇ 下载
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-700 bg-gray-900 p-4">
        <div className="flex items-end gap-3">
          <button className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700" title="上传参考素材">
            <Paperclip className="w-5 h-5" />
          </button>
          <textarea
            placeholder="描述你想生成的视频... (功能即将上线)"
            disabled
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 resize-none border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 opacity-50 cursor-not-allowed"
            rows={1}
          />
          <button
            disabled
            className="p-2.5 bg-gray-700 text-gray-500 rounded-xl cursor-not-allowed"
            title="发送"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-400">模型:</span>
          <select disabled className="bg-gray-700 text-gray-400 text-sm rounded-lg px-3 py-1.5 border border-gray-600 cursor-not-allowed opacity-50">
            <option>待配置</option>
          </select>
        </div>
      </div>
    </div>
  );
}
