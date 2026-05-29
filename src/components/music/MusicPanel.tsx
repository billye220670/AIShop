import { useState } from 'react';

interface AudioItem {
  id: string;
  url: string;
  prompt: string;
  title: string;
  timestamp: number;
}

export default function MusicPanel() {
  const [audios] = useState<AudioItem[]>([]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-gray-900/50">
        <h2 className="text-lg font-semibold">AI 音乐生成</h2>
        <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded">即将上线</span>
      </div>

      {/* Audio wall */}
      <div className="flex-1 overflow-y-auto p-6">
        {audios.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-5xl mb-4">🎵</div>
            <p className="text-lg">音乐生成模式</p>
            <p className="text-sm mt-2">此功能即将上线，敬请期待</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {audios.map((audio) => (
              <div key={audio.id} className="rounded-xl overflow-hidden bg-gray-800 border border-gray-700 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-white truncate">{audio.title}</h3>
                  <button className="text-xs text-blue-400 hover:text-blue-300">
                    ⬇ 下载
                  </button>
                </div>
                <audio src={audio.url} className="w-full" controls />
                <p className="text-xs text-gray-400 mt-2 truncate">{audio.prompt}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-700 bg-gray-900 p-4">
        <div className="flex items-end gap-3">
          <button className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700" title="上传参考">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <textarea
            placeholder="描述你想生成的音乐风格和内容... (功能即将上线)"
            disabled
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 resize-none border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 opacity-50 cursor-not-allowed"
            rows={1}
          />
          <button
            disabled
            className="p-2.5 bg-gray-700 text-gray-500 rounded-xl cursor-not-allowed"
            title="发送"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
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
