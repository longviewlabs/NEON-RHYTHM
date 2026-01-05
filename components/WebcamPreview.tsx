/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { COLORS } from "../types";
import { countFingers } from "../hooks/useHandDetection";

interface WebcamPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  landmarksRef: React.MutableRefObject<NormalizedLandmark[] | null>;
  fingerCountRef: React.MutableRefObject<number>;
  isCameraReady: boolean;
  showFingerVector?: boolean;
}

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4], // Thumb
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8], // Index
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12], // Middle
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16], // Ring
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20], // Pinky
  [5, 9],
  [9, 13],
  [13, 17],
  [0, 5],
  [0, 17], // Palm
];

const WebcamPreview: React.FC<WebcamPreviewProps> = ({
  videoRef,
  landmarksRef,
  fingerCountRef,
  isCameraReady,
  showFingerVector = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isCameraReady) return;
    let animationFrameId: number;
    let lastRenderTime = 0;

    // Cache for layout values to avoid repetitive DOM reads
    let cachedW = 0;
    let cachedH = 0;

    const render = () => {
      if (!showFingerVector) {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      const now = performance.now();
      if (now - lastRenderTime < 33) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      lastRenderTime = now;

      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (canvas && video && video.readyState >= 2) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Use window values but cache them locally for the frame
          const screenW = window.innerWidth;
          const screenH = window.innerHeight;

          if (cachedW !== screenW || cachedH !== screenH) {
            canvas.width = screenW;
            canvas.height = screenH;
            cachedW = screenW;
            cachedH = screenH;
          }

          ctx.clearRect(0, 0, screenW, screenH);

          const landmarks = landmarksRef.current;
          if (landmarks) {
            // console.log("[WebcamPreview] Drawing landmarks:", landmarks.length);
            const videoW = video.videoWidth;
            const videoH = video.videoHeight;
            const videoRatio = videoW / videoH;
            const screenRatio = screenW / screenH;

            let drawW, drawH, startX, startY;

            if (screenRatio > videoRatio) {
              drawW = screenW;
              drawH = screenW / videoRatio;
              startX = 0;
              startY = (screenH - drawH) / 2;
            } else {
              drawH = screenH;
              drawW = screenH * videoRatio;
              startX = (screenW - drawW) / 2;
              startY = 0;
            }

            // Draw Skeleton
            ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
            ctx.lineWidth = 3;
            ctx.lineCap = "round";

            const points = landmarks.map((lm) => ({
              x: startX + (1 - lm.x) * drawW,
              y: startY + lm.y * drawH,
            }));

            ctx.beginPath();
            for (const [start, end] of HAND_CONNECTIONS) {
              const p1 = points[start];
              const p2 = points[end];
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();

            // Draw Joints
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            for (const p of points) {
              ctx.beginPath();
              ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
              ctx.fill();
            }

            // Draw Finger Count
            const currentCount = fingerCountRef.current;
            let minY = Infinity;
            let topX = 0;
            for (const p of points) {
              if (p.y < minY) {
                minY = p.y;
                topX = p.x;
              }
            }

            const textY = minY - 30;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";

            // Count Number
            ctx.font = "900 100px Inter, system-ui, sans-serif";
            ctx.fillStyle = currentCount === 0 ? "#ef4444" : "#fbbf24";
            ctx.strokeStyle = "rgba(0,0,0,0.8)";
            ctx.lineWidth = 6;
            ctx.strokeText(currentCount.toString(), topX, textY);
            ctx.fillText(currentCount.toString(), topX, textY);

            // "FINGERS" Label
            ctx.font = "900 16px Inter, system-ui, sans-serif";
            ctx.strokeText("FINGERS", topX, textY - 95);
            ctx.fillText("FINGERS", topX, textY - 95);
          }
        }
      }
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isCameraReady, videoRef, showFingerVector, landmarksRef, fingerCountRef]);

  if (!isCameraReady) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-30"
    />
  );
};

export default React.memo(WebcamPreview);
