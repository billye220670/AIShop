export default function LoadingDots() {
  return (
    <div className="flex items-center py-1">
      <div className="loading-dots-container">
        <span className="loading-dot" />
        <span className="loading-dot" />
        <span className="loading-dot" />
      </div>
      <style>{`
        .loading-dots-container {
          position: relative;
          width: 58px;
          height: 10px;
        }
        .loading-dot {
          position: absolute;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: #6b7280;
          left: 0;
          top: 0;
          will-change: transform;
          animation: dotFlow 1.5s linear infinite;
        }
        .loading-dot:nth-child(1) { animation-delay: 0s; }
        .loading-dot:nth-child(2) { animation-delay: -0.5s; }
        .loading-dot:nth-child(3) { animation-delay: -1s; }
        @keyframes dotFlow {
          0% {
            transform: translateX(0px) scale(0);
          }
          33.33% {
            transform: translateX(16px) scale(1);
          }
          66.66% {
            transform: translateX(32px) scale(1);
          }
          100% {
            transform: translateX(48px) scale(0);
          }
        }
      `}</style>
    </div>
  );
}
