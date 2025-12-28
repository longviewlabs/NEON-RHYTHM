/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { COLORS } from "../types";
import { countFingers } from "../hooks/useMediaPipe";

interface WebcamPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  landmarksRef: React.MutableRefObject<NormalizedLandmark[] | null>;
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
  isCameraReady,
  showFingerVector = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isCameraReady) return;
    let animationFrameId: number;
    let lastRenderTime = 0;

    const render = () => {
      if (!showFingerVector) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx && canvas) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      const now = performance.now();
      // Throttle to ~30 FPS (33ms) to save CPU
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
          // Match canvas to window (full screen overlay)
          const screenW = window.innerWidth;
          const screenH = window.innerHeight;

          if (canvas.width !== screenW || canvas.height !== screenH) {
            canvas.width = screenW;
            canvas.height = screenH;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // --- Object-Cover Math ---
          // Updated for object-cover behavior to ensure alignment
          const videoRatio = video.videoWidth / video.videoHeight;
          const screenRatio = screenW / screenH;

          let drawW, drawH, startX, startY;

          if (screenRatio > videoRatio) {
            // Screen is wider than video -> scale to screen width, crop top/bottom
            drawW = screenW;
            drawH = screenW / videoRatio;
            startX = 0;
            startY = (screenH - drawH) / 2;
          } else {
            // Screen is narrower than video -> scale to screen height, crop sides
            drawH = screenH;
            drawW = screenH * videoRatio;
            startX = (screenW - drawW) / 2;
            startY = 0;
          }

          // --- Draw Landmarks ---
          if (landmarksRef.current) {
            const landmarks = landmarksRef.current;

            ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"; // Solid White
            ctx.lineWidth = 3;
            ctx.lineCap = "round";

            const getCoords = (lm: NormalizedLandmark) => {
              // Mirror X: (1 - x)
              const mirroredX = 1 - lm.x;

              // Map to screen coords considering the object-cover transform
              const screenX = startX + mirroredX * drawW;
              const screenY = startY + lm.y * drawH;
              return { x: screenX, y: screenY };
            };

            // Draw connections
            ctx.beginPath();
            for (const [start, end] of HAND_CONNECTIONS) {
              const p1 = getCoords(landmarks[start]);
              const p2 = getCoords(landmarks[end]);
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();

            // Draw Joints
            ctx.fillStyle = "rgba(200, 200, 200, 0.8)"; // Simple Gray for joints
            for (const lm of landmarks) {
              const p = getCoords(lm);
              ctx.beginPath();
              ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
              ctx.fill();
            }

            // Draw Finger Count above the hand
            const ratio = video.videoWidth / video.videoHeight;
            const currentCount = countFingers(landmarks, ratio);

            // ALWAYS show the count if landmarks are present, including 0
            // This provides feedback that a "fist" (0) is correctly detected.
            if (landmarks && landmarks.length > 0) {
              // Find the topmost point of the hand
              let minY = Infinity;
              let topX = 0;
              for (const lm of landmarks) {
                const p = getCoords(lm);
                if (p.y < minY) {
                  minY = p.y;
                  topX = p.x;
                }
              }

              // Draw Count Text
              ctx.fillStyle = currentCount === 0 ? "#ef4444" : "#fbbf24"; // Red for 0, Yellow for others
              ctx.strokeStyle = "black";
              ctx.lineWidth = 6;
              ctx.font = "900 100px Inter, system-ui, sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "bottom";

              const textY = minY - 20;
              ctx.strokeText(currentCount.toString(), topX, textY);
              ctx.fillText(currentCount.toString(), topX, textY);

              // Reset shadow for the label
              ctx.shadowBlur = 0;

              // Add a small label
              ctx.font = "900 14px Inter, system-ui, sans-serif";
              ctx.fillStyle = currentCount === 0 ? "#ef4444" : "#fbbf24";
              ctx.strokeStyle = "black";
              ctx.lineWidth = 3;
              (ctx as any).letterSpacing = "2px";
              ctx.strokeText("FINGERS", topX, textY - 100);
              ctx.fillText("FINGERS", topX, textY - 100);
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isCameraReady, videoRef, showFingerVector]);

  if (!isCameraReady) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-30"
    />
  );
};

export default React.memo(WebcamPreview);
