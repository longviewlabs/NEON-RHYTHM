/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { COLORS } from "../types";

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

    const render = () => {
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
          // Calculate how the video is being scaled/cropped by CSS object-cover
          const videoRatio = video.videoWidth / video.videoHeight;
          const screenRatio = screenW / screenH;

          let drawW, drawH, startX, startY;

          if (screenRatio > videoRatio) {
            // Screen is wider than video -> fit height, letterbox left/right
            drawH = screenH;
            drawW = screenH * videoRatio;
            startX = (screenW - drawW) / 2;
            startY = 0;
          } else {
            // Screen is narrower than video -> fit width, letterbox top/bottom
            drawW = screenW;
            drawH = screenW / videoRatio;
            startX = 0;
            startY = (screenH - drawH) / 2;
          }

          // --- Draw Landmarks ---
          if (showFingerVector && landmarksRef.current) {
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
