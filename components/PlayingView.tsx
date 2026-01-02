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
    <div className="w-full h-full flex flex-col justify-between py-6 md:py-12 relative">
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
          status === GameStatus.TRANSITION ||
          status === GameStatus.ROUND_END) && (
          <div className="flex flex-col items-center w-full">
            <SequenceDisplay
              sequence={sequence}
              currentBeat={currentBeat}
              countdown={countdown}
            />
          </div>
        )}

        {status === GameStatus.ANALYZING && (
          <div className="flex flex-col items-center gap-4 md:gap-6 animate-pop px-4">
            <h2 className="text-2xl md:text-4xl font-black uppercase text-glow animate-pulse">
              ANALYZING...
            </h2>
          </div>
        )}
      </div>

      {status === GameStatus.ROUND_END && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex gap-6 w-full max-w-xl px-6">
          <button
            onClick={onFail}
            className="flex-1 py-5 bg-red-600/80 hover:bg-red-700 text-white font-black uppercase tracking-[0.2em] text-lg rounded-2xl shadow-[0_0_30px_rgba(220,38,38,0.4)] backdrop-blur-md active:scale-95 transition-all border border-red-500/30"
          >
            FAIL
          </button>
          <button
            onClick={onPass}
            className="flex-1 py-5 bg-green-600/80 hover:bg-green-700 text-white font-black uppercase tracking-[0.2em] text-lg rounded-2xl shadow-[0_0_30px_rgba(34,197,94,0.4)] backdrop-blur-md active:scale-95 transition-all border border-green-500/30"
          >
            PASS
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(PlayingView);
