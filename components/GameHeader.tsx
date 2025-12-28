import React from "react";

interface GameHeaderProps {
  currentRound: number;
  currentBpm: number;
  displayRound: number;
  exitingRound: number | null;
}

const GameHeader: React.FC<GameHeaderProps> = ({
  currentRound,
  currentBpm,
  displayRound,
  exitingRound,
}) => {
  return (
    <div className="absolute top-10 left-0 right-0 z-50 flex flex-col items-center pointer-events-none scale-110 md:scale-125 overflow-hidden">
      <div className="relative h-24 md:h-32 w-full flex items-center justify-center">
        {exitingRound !== null && (
          <div
            key={`exit-${exitingRound}`}
            className="absolute text-6xl md:text-8xl font-black text-white/50 drop-shadow-[0_0_30px_rgba(255,255,255,0.2)] uppercase italic tracking-tighter animate-round-slide-out leading-none"
          >
            ROUND {exitingRound}
          </div>
        )}
        <div
          key={`enter-${displayRound}`}
          className="absolute text-6xl md:text-8xl font-black text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.4)] uppercase italic tracking-tighter animate-round-slide-in leading-none"
        >
          ROUND {displayRound}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3 px-4 py-1.5 bg-white/10 backdrop-blur-xl rounded-full border border-white/20 shadow-2xl">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
        <span className="text-[10px] md:text-xs font-black text-white/90 uppercase tracking-[0.25em]">
          {currentBpm} BPM
        </span>
      </div>
    </div>
  );
};

export default React.memo(GameHeader);
