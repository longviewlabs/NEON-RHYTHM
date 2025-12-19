import React from "react";
import { X, Settings } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showFingerVector: boolean;
  setShowFingerVector: (show: boolean) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  showFingerVector,
  setShowFingerVector,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in duration-200">
      <div
        className="glass-panel p-6 md:p-8 rounded-3xl max-w-sm w-full animate-pop shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <Settings className="text-[#00f3ff]" size={24} />
            <h2 className="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] to-[#ff00ff]">
              SETTINGS
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-white/5 rounded-full hover:bg-white/10 active:scale-90 transition-all text-white/50 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors group">
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-widest text-white/80 group-hover:text-white transition-colors">
                HAND SKELETON
              </span>
              <span className="text-[10px] text-white/40 uppercase font-bold">
                Visualize finger tracking
              </span>
            </div>
            <button
              onClick={() => setShowFingerVector(!showFingerVector)}
              className={`w-14 h-7 rounded-full transition-all relative flex items-center px-1 ${
                showFingerVector
                  ? "bg-[#00f3ff]/20 border border-[#00f3ff]/50"
                  : "bg-white/5 border border-white/10"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full transition-all shadow-lg ${
                  showFingerVector
                    ? "translate-x-7 bg-[#00f3ff] shadow-[0_0_10px_#00f3ff]"
                    : "translate-x-0 bg-white/20"
                }`}
              />
            </button>
          </div>

          <div className="pt-4 border-t border-white/5">
            <p className="text-[9px] text-white/20 uppercase font-bold tracking-[0.2em] text-center">
              v1.0.0 • NEON RHYTHM ENGINE
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
