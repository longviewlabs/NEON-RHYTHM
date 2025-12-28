import React from "react";

interface TransitionOverlayProps {
  currentRound: number;
  currentBpm: number;
}

const TransitionOverlay: React.FC<TransitionOverlayProps> = ({
  currentRound,
  currentBpm,
}) => {
  return (
    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in-fast">
      <div className="flex flex-col items-center gap-2">
        <div
          className="text-4xl md:text-6xl font-black text-white/80 uppercase tracking-widest animate-slide-in-top opacity-0"
          style={{
            animationDelay: "0.1s",
            animationFillMode: "forwards",
          }}
        >
          NEXT UP
        </div>
        <div
          className="text-6xl md:text-9xl font-black text-white drop-shadow-[0_0_50px_rgba(255,255,255,0.6)] italic tracking-tighter leading-none animate-zoom-in-pop opacity-0 px-3 whitespace-nowrap"
          style={{
            animationDelay: "0.3s",
            animationFillMode: "forwards",
          }}
        >
          ROUND {currentRound}
        </div>
        <div className="relative mt-4">
          <div className="absolute -inset-4 bg-red-500/20 blur-xl rounded-full animate-pulse"></div>
          <div
            className="relative text-6xl md:text-8xl font-black text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,1)] tracking-widest animate-slide-in-bottom opacity-0"
            style={{
              animationDelay: "0.5s",
              animationFillMode: "forwards",
            }}
          >
            {currentBpm} BPM
          </div>
        </div>
        <div
          className="mt-8 text-xl text-white/60 font-bold tracking-[0.5em] animate-bounce animate-fade-in-delayed opacity-0"
          style={{
            animationDelay: "0.7s",
            animationFillMode: "forwards",
          }}
        >
          SPEED INCREASING...
        </div>
      </div>
    </div>
  );
};

export default React.memo(TransitionOverlay);
