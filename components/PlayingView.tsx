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
}) => {
  if (
    status !== GameStatus.PLAYING &&
    status !== GameStatus.ANALYZING &&
    status !== GameStatus.TRANSITION
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
      </div>
    </div>
  );
};

export default React.memo(PlayingView);
