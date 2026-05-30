export default function LoadingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="loading-dot" />
      <span className="loading-dot" />
      <span className="loading-dot" />
      <style>{`
        .loading-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background-color: #6b7280;
          animation: dotMove 1.4s ease-in-out infinite;
        }
        .loading-dot:nth-child(1) { animation-delay: 0s; }
        .loading-dot:nth-child(2) { animation-delay: 0.2s; }
        .loading-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dotMove {
          0% {
            transform: translateX(-8px) scale(0);
            opacity: 0;
          }
          20% {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
          80% {
            transform: translateX(8px) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateX(16px) scale(0);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
