import React from "react";

interface MenuViewProps {
  isCameraReady: boolean;
  onStartInfinite: () => void;
}

const MenuView: React.FC<MenuViewProps> = ({
  isCameraReady,
  onStartInfinite,
}) => {
  return (
    <div className="flex flex-col items-center gap-4 md:gap-8 animate-pop w-full max-w-sm md:max-w-none">
      {!isCameraReady ? (
        <div className="text-yellow-400 animate-pulse text-xs md:text-sm">
          Initializing Camera...
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center text-center">
            {/* Title wrappers can be added here if needed */}
          </div>

          <button
            onClick={onStartInfinite}
            className="group relative px-12 py-5 rounded-full bg-white text-black font-black text-2xl tracking-widest active:scale-95 transition-transform shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
          >
            START INFINITE
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(MenuView);
