import React from "react";

interface CountdownOverlayProps {
  countdown: number;
}

const CountdownOverlay: React.FC<CountdownOverlayProps> = ({ countdown }) => {
  return (
    <div className="absolute top-[25%] left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div
        key={countdown}
        className="text-9xl md:text-[12rem] font-black text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.8)] animate-countdown-dramatic"
      >
        {countdown}
      </div>
    </div>
  );
};

export default React.memo(CountdownOverlay);
