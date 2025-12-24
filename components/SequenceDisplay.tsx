import React from "react";

interface SequenceDisplayProps {
  sequence: number[];
  currentBeat: number;
  countdown: number | null;
}

const SequenceDisplay: React.FC<SequenceDisplayProps> = ({
  sequence,
  currentBeat,
  countdown,
}) => {
  const isLong = sequence.length > 12;
  const midPoint = isLong ? Math.ceil(sequence.length / 2) : sequence.length;

  const renderRow = (nums: number[], startIdx: number) => (
    <div className="flex flex-wrap justify-center items-center font-bold text-4xl md:text-6xl lg:text-7xl text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)] gap-0">
      {nums.map((num, i) => {
        const globalIdx = i + startIdx;
        const isCurrent = globalIdx === currentBeat;

        let displayClass = "transition-all duration-300 ease-out inline-block";
        if (isCurrent && countdown === null) {
          displayClass += " text-yellow-400 scale-[1.6] drop-shadow-[0_0_30px_rgba(250,204,21,0.6)] z-10 font-black";
        } else {
          displayClass += " text-white opacity-100";
        }

        return (
          <React.Fragment key={globalIdx}>
            {i > 0 && (
              <span
                className="mx-0.5 opacity-80 animate-appear"
                style={{ animationDelay: `${globalIdx * 0.1}s`, opacity: 0, animationFillMode: 'forwards' }}
              >
                -
              </span>
            )}
            <span
              className={`${displayClass} animate-appear`}
              style={{ animationDelay: `${globalIdx * 0.1}s`, opacity: 0, animationFillMode: 'forwards' }}
            >
              {num}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div
      className={`flex flex-col items-center select-none animate-pop w-full px-4 transition-all duration-500 ${countdown !== null ? "opacity-20" : "opacity-100"
        }`}
    >
      <div className="flex flex-col items-center gap-2 md:gap-4 transition-all duration-500">
        {renderRow(sequence.slice(0, midPoint), 0)}
        {isLong && renderRow(sequence.slice(midPoint), midPoint)}
      </div>
    </div>
  );
};

export default React.memo(SequenceDisplay);


