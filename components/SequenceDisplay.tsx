import React from "react";

interface SequenceDisplayProps {
  sequence: number[];
  currentBeat: number;
  countdown: number | null;
  localResults?: (boolean | null)[];
}

const SequenceDisplay: React.FC<SequenceDisplayProps> = ({
  sequence,
  currentBeat,
  countdown,
  localResults = [],
}) => {
  return (
    <div className="flex flex-wrap justify-center items-center select-none w-full max-w-4xl mx-auto px-4 gap-y-4 md:gap-y-8 transition-all duration-500 opacity-100">
      {sequence.map((num, i) => {
        const isCurrent = i === currentBeat;
        const result = localResults[i];

        let displayClass = "transition-all duration-300 ease-out inline-block";

        if (result === false) {
          // WRONG: Red
          displayClass +=
            " text-red-500 font-black drop-shadow-[0_0_20px_rgba(239,68,68,0.8)]";
        } else if (isCurrent && countdown === null) {
          // CURRENT: Yellow
          displayClass +=
            " text-yellow-400 scale-[1.5] drop-shadow-[0_0_30px_rgba(250,204,21,0.6)] z-10 font-black";
        } else {
          // UPCOMING/DEFAULT/CORRECT: White
          displayClass += " text-white opacity-100";
        }

        return (
          <div
            key={i}
            className="flex items-center whitespace-nowrap font-bold text-4xl md:text-6xl lg:text-7xl text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)]"
          >
            <span className={displayClass}>{num}</span>
            {i < sequence.length - 1 && (
              <span className="mx-0.5 md:mx-1 opacity-60 font-light">-</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(SequenceDisplay);
