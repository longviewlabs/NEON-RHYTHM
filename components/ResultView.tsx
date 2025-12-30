import React from "react";
import Robot from "./Robot";
import { Download } from "lucide-react";
import { RobotState } from "../types";
import { ShareTarget } from "../utils/shareUtils";

interface ResultViewProps {
  revealedResults: (boolean | null)[];
  sequence: number[];
  isInfiniteMode: boolean;
  currentRound: number;
  robotState: RobotState;
  isRecording: boolean;
  videoBlob: Blob | null;
  isVideoDownloaded: boolean;
  showSaveToast: boolean;
  onReplay: () => void;
  onBackToMenu: () => void;
  onNextRound: () => void;
  onShare: (target: ShareTarget) => void;
  onSaveVideo: () => void;
}

const ResultView: React.FC<ResultViewProps> = ({
  revealedResults,
  sequence,
  isInfiniteMode,
  currentRound,
  robotState,
  isRecording,
  videoBlob,
  isVideoDownloaded,
  showSaveToast,
  onReplay,
  onBackToMenu,
  onNextRound,
  onShare,
  onSaveVideo,
}) => {
  const currentCorrect = revealedResults.filter((r) => r === true).length;
  const isFinished =
    (revealedResults.length > 0 && revealedResults.every((r) => r != null)) ||
    (isInfiniteMode && revealedResults.some((r) => r === false));
  const isPerfect = isFinished && currentCorrect === sequence.length;
  const hideForInfiniteFail = isInfiniteMode && !isPerfect;

  if (!isFinished && !hideForInfiniteFail) {
    return (
      <div className="flex flex-col items-center gap-4 md:gap-6 animate-pop px-4">
        <h2 className="text-2xl md:text-4xl font-black uppercase text-glow animate-pulse">
          ANALYZING...
        </h2>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center relative gap-2 md:gap-4 pb-40">
      {/* BIG ANIMATED FAIL TITLE AND SUBTITLE */}
      {hideForInfiniteFail && (
        <div className="z-[100] pointer-events-none mb-10 md:mb-20 animate-fail-stamp flex flex-col items-start translate-x-[-2%]">
          <div className="text-[7rem] md:text-[16rem] font-black text-red-600 drop-shadow-[0_0_50px_rgba(220,38,38,0.8)] uppercase italic tracking-tighter select-none leading-none">
            FAIL
          </div>
          <div className="text-[1.3rem] md:text-[2.8rem] font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] uppercase italic tracking-tighter select-none leading-none mt-[-8px] md:mt-[-20px] pl-1 md:pl-3 whitespace-nowrap">
            Made it to Round {currentRound}
          </div>
        </div>
      )}

      <div
        className="flex flex-col items-center animate-slide-up-pop w-full"
        style={{
          animationDelay: "0s",
          opacity: 0,
          animationFillMode: "forwards",
        }}
      >
        {!isInfiniteMode && <Robot state={robotState} />}

        <div className="flex flex-col items-center gap-3 md:gap-5 mt-4 md:mt-16 w-full max-w-sm">
          {isFinished && !isPerfect && (
            <div className="flex flex-col items-center gap-4 w-full">
              <button
                onClick={onReplay}
                className="px-12 py-5 bg-red-600 text-white font-black uppercase tracking-widest text-xl hover:bg-red-700 active:scale-95 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.5)] rounded-2xl w-full min-w-[280px]"
              >
                {isInfiniteMode ? `REPLAY ROUND ${currentRound}` : "TRY AGAIN"}
              </button>

              <button
                onClick={onBackToMenu}
                className="text-white/60 text-xs font-bold uppercase tracking-[0.2em] hover:text-white transition-colors mt-2"
              >
                Back to Menu
              </button>
            </div>
          )}

          {isFinished && isPerfect && (
            <div className="flex flex-col items-center gap-4 w-full">
              <button
                onClick={onNextRound}
                className="px-12 py-5 bg-green-600 text-white font-black uppercase tracking-widest text-xl hover:bg-green-700 hover:scale-105 active:scale-95 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.5)] rounded-2xl w-full min-w-[280px]"
              >
                NEXT ROUND
              </button>
              <button
                onClick={onReplay}
                className="text-white text-[11px] md:text-xs font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] opacity-60 hover:opacity-100 transition-opacity underline underline-offset-8"
              >
                Replay Level
              </button>
            </div>
          )}
        </div>
      </div>

      {/* FIXED BOTTOM SHARE BUTTON */}
      <div
        className="fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center px-4 animate-slide-up-pop pb-[env(safe-area-inset-bottom)]"
        style={{
          animationDelay: hideForInfiniteFail ? "0.8s" : "0s",
          opacity: 0,
          animationFillMode: "forwards",
        }}
      >
        <div className="flex flex-col items-center gap-2 w-full max-w-sm">
          <button
            disabled={isRecording || !videoBlob}
            onClick={() => onShare("system")}
            className={`group relative px-12 py-5 rounded-2xl font-black text-xl tracking-widest transition-all shadow-[0_8px_20px_rgba(0,0,0,0.4)] w-full min-w-[280px] flex items-center justify-center gap-3 overflow-hidden ${
              isRecording || !videoBlob
                ? "bg-white/10 text-white/30 cursor-not-allowed"
                : "bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:scale-[1.02] active:scale-95"
            }`}
          >
            <span className="relative z-10">
              {isRecording || !videoBlob
                ? "PREPARING VIDEO..."
                : "SHARE THIS VIDEO"}
            </span>
            {!isRecording && videoBlob && (
              <span className="text-2xl">🔥</span>
            )}
            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out pointer-events-none" />
          </button>
          {isRecording && (
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest animate-pulse">
              Processing High-Quality Export...
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(ResultView);
