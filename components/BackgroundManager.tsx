import React from "react";
import SafeZone from "./SafeZone";
import { GameStatus } from "../types";

interface BackgroundManagerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isCameraReady: boolean;
  videoOpacity: number;
  showFlash: boolean;
  status: GameStatus;
}

const BackgroundManager: React.FC<BackgroundManagerProps> = ({
  canvasRef,
  videoRef,
  isCameraReady,
  videoOpacity,
  showFlash,
  status,
}) => {
  return (
    <>
      {/* Hidden Canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* FAIL FLASH OVERLAY */}
      {showFlash && <div className="fail-flash-overlay" />}

      {/* Background Video */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
        style={{
          opacity: videoOpacity,
        }}
        playsInline
        muted
        autoPlay
      />

      {/* 9:16 SAFE ZONE FOR DESKTOP */}
      <SafeZone />

      {/* Minimal Overlay Shadow (Top only for visibility) */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/40 to-transparent pointer-events-none z-10" />
    </>
  );
};

export default React.memo(BackgroundManager);
