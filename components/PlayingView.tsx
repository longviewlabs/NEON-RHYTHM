import React from "react";
import GameHeader from "./GameHeader";
import TransitionOverlay from "./TransitionOverlay";
import CountdownOverlay from "./CountdownOverlay";
import SequenceDisplay from "./SequenceDisplay";
import { GameStatus } from "../types";

interface PlayingViewProps {
  status: GameStatus;
  currentRound: number;
  currentBpm: number;
  displayRound: number;
  exitingRound: number | null;
  countdown: number | null;
  sequence: number[];
  currentBeat: number;
  localResults: (boolean | null)[];
  onPass: () => void;
  onFail: () => void;
}

const PlayingView: React.FC<PlayingViewProps> = ({
  status,
  currentRound,
  currentBpm,
  displayRound,
  exitingRound,
  countdown,
  sequence,
  currentBeat,
  localResults,
  onPass,
  onFail,
}) => {
  if (
    status !== GameStatus.PLAYING &&
    status !== GameStatus.ANALYZING &&
    status !== GameStatus.TRANSITION &&
    status !== GameStatus.ROUND_END
  ) {
    return null;
  }

  return (
    <div className="w-full h-full flex flex-col justify-between py-6 md:py-12">
      {status !== GameStatus.TRANSITION && (
        <GameHeader
          currentRound={currentRound}
          currentBpm={currentBpm}
          displayRound={displayRound}
          exitingRound={exitingRound}
        />
      )}

      {status === GameStatus.TRANSITION && (
        <TransitionOverlay
          currentRound={currentRound}
          currentBpm={currentBpm}
        />
      )}

      {countdown !== null && <CountdownOverlay countdown={countdown} />}

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center w-full z-40 pointer-events-none">
        {(status === GameStatus.PLAYING ||
          status === GameStatus.TRANSITION) && (
          <div className="flex flex-col items-center w-full">
            <SequenceDisplay
              sequence={sequence}
              currentBeat={currentBeat}
              countdown={countdown}
              localResults={localResults}
            />
          </div>
        )}

        {status === GameStatus.ANALYZING &&
          !localResults.some((r) => r === false) && (
            <div className="flex flex-col items-center gap-4 md:gap-6 animate-pop px-4">
              <h2 className="text-2xl md:text-4xl font-black uppercase text-glow animate-pulse">
                ANALYZING...
              </h2>
              <p className="text-white/60 text-xs md:text-sm text-center">
                The AI Judge is watching your moves
              </p>
            </div>
          )}
        {status === GameStatus.ROUND_END && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50 animate-in fade-in duration-300 pointer-events-auto">
            <div className="flex gap-4 md:gap-8 scale-150">
              <button
                onClick={onFail}
                className="w-24 h-24 rounded-full bg-red-500 hover:bg-red-400 text-white font-black text-xl shadow-[0_0_40px_rgba(239,68,68,0.6)] border-4 border-white/20 transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
              >
                FAIL
              </button>
              <button
                onClick={onPass}
                className="w-24 h-24 rounded-full bg-green-500 hover:bg-green-400 text-white font-black text-xl shadow-[0_0_40px_rgba(34,197,94,0.6)] border-4 border-white/20 transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
              >
                PASS
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(PlayingView);
