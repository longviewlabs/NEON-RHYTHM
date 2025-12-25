import React, { useState } from "react";

interface StartScreenProps {
  onStart: () => void;
  isAssetsReady: boolean;
}

const StartScreen: React.FC<StartScreenProps> = ({ onStart, isAssetsReady }) => {
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleStart = () => {
    if (!isAssetsReady) return;

    setIsTransitioning(true);
    // The transition takes about 500ms in the template, 
    // but the actual "Initiate" log happens after 150ms.
    setTimeout(() => {
      onStart();
    }, 650);
  };

  return (
    <div className={`container-viral ${isTransitioning ? 'opacity-0 scale-50 rotate-[10deg] duration-500 ease-in-out' : 'animate-pop'}`}
      style={{
        transition: isTransitioning ? 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)' : 'none'
      }}>
      <div className="title-wrapper-viral">
        <h1 className="title-viral">
          <div className="text-content">
            <span className="top">FINGER</span>
            <span className="bottom">RHYTHM</span>
          </div>
        </h1>
        <div className="subtitle-viral">
          ONLY 1% CAN PASS 💀
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={!isAssetsReady}
        className="start-btn-viral disabled:opacity-50 disabled:cursor-not-allowed group"
      >
        <span>LFG!</span>
        <span className="emoji">🔥</span>
      </button>

      <div className="footer-hint-viral">
        GET YOUR FINGERS READY 👋
      </div>
    </div>
  );
};

export default StartScreen;

