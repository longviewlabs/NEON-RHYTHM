/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import {
  HandLandmarker,
  FilesetResolver,
  HandLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// Detect mobile once outside the hook
const IS_MOBILE =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Helper: Calculate Squared 3D distance (avoids expensive Math.sqrt)
export const getDistanceSq3D = (
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  ratio: number = 1
): number => {
  const dx = (a.x - b.x) * ratio;
  const dy = a.y - b.y;
  const dz = (a.z - b.z) * ratio;
  return dx * dx + dy * dy + dz * dz;
};

// Helper: Calculate angle at point B given points A, B, C (in degrees) using 3D coordinates
export const getAngle = (
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark,
  ratio: number = 1
): number => {
  // Vectors AB and CB in standardized coordinates
  const ab = {
    x: (a.x - b.x) * ratio,
    y: a.y - b.y,
    z: (a.z - b.z) * ratio,
  };
  const cb = {
    x: (c.x - b.x) * ratio,
    y: c.y - b.y,
    z: (c.z - b.z) * ratio,
  };

  // Dot product in 3D
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;

  // Magnitudes in 3D
  const magAB = Math.hypot(ab.x, ab.y, ab.z);
  const magCB = Math.hypot(cb.x, cb.y, cb.z);

  if (magAB === 0 || magCB === 0) return 180; // Avoid division by zero

  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB))); // Clamp to [-1, 1]
  return Math.acos(cosAngle) * (180 / Math.PI);
};

// Helper: Count extended fingers using Squared Relative Distances (Rotation Invariant)
export const countFingers = (
  landmarks: NormalizedLandmark[],
  ratio: number
): number => {
  if (!landmarks || landmarks.length < 21) return 0;

  const wrist = landmarks[0];
  const PinkyMCP = landmarks[17];
  let count = 0;

  // --- THUMB (Points 2, 3, 4) ---
  // LOGIC: Is the thumb tip further from the pinky knuckle than the base joint?
  const thumbIP = landmarks[3];
  const thumbTip = landmarks[4];
  const indexMCP = landmarks[5];

  const distSqTipToPinky = getDistanceSq3D(thumbTip, PinkyMCP, ratio);
  const distSqIpToPinky = getDistanceSq3D(thumbIP, PinkyMCP, ratio);

  // If tip is significantly further from pinky than the inner joint, it's "out"
  // Increased threshold to 1.15x (1.3225 squared) for better fist detection
  if (distSqTipToPinky > distSqIpToPinky * 1.3225) {
    // Also check if it's not tucked deep into the palm
    const distSqTipToWrist = getDistanceSq3D(thumbTip, wrist, ratio);
    const distSqMcpToWrist = getDistanceSq3D(landmarks[2], wrist, ratio);

    // And check if it's not just resting on the index finger (fist)
    const distSqTipToIndex = getDistanceSq3D(thumbTip, indexMCP, ratio);
    const distSqMcpToIndex = getDistanceSq3D(landmarks[2], indexMCP, ratio);

    if (
      distSqTipToWrist > distSqMcpToWrist * 0.7 && // Stricter wrist distance
      distSqTipToIndex > distSqMcpToIndex * 1.1 // Must be away from index finger
    ) {
      count++;
    }
  }

  // --- FINGERS (Index, Middle, Ring, Pinky) ---
  const fingers = [
    { mcp: 5, tip: 8 }, // Index
    { mcp: 9, tip: 12 }, // Middle
    { mcp: 13, tip: 16 }, // Ring
    { mcp: 17, tip: 20 }, // Pinky
  ];

  for (const f of fingers) {
    const mcp = landmarks[f.mcp];
    const tip = landmarks[f.tip];

    const distSqWristTip = getDistanceSq3D(wrist, tip, ratio);
    const distSqWristMcp = getDistanceSq3D(wrist, mcp, ratio);

    // LOGIC: Is the tip significantly "out" from the knuckle?
    // 1.35 threshold -> 1.8225 for squared comparison
    if (distSqWristTip > distSqWristMcp * 1.8225) {
      count++;
    }
  }

  return count;
};

export const useMediaPipe = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onCountUpdate?: (count: number) => void
) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);
  const lastCountRef = useRef<number>(0);

  // Throttling: 30 FPS (33ms) is plenty for rhythm tracking and saves massive CPU/battery
  const DETECTION_INTERVAL = 33;

  // Temporal smoothing: store recent finger counts
  const fingerHistoryRef = useRef<number[]>([]);
  const HISTORY_SIZE = IS_MOBILE ? 3 : 5; // Smaller history for faster response on mobile

  // Get MODE (most frequent value) from array
  const getMode = (arr: number[]): number => {
    const freq: Record<number, number> = {};
    let maxFreq = 0;
    let mode = arr[0];
    for (const n of arr) {
      freq[n] = (freq[n] || 0) + 1;
      if (freq[n] > maxFreq) {
        maxFreq = freq[n];
        mode = n;
      }
    }
    return mode;
  };

  useEffect(() => {
    let isActive = true;
    let isTabVisible = true;

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const setupMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );

        if (!isActive) return;

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: IS_MOBILE ? "CPU" : "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.7,
          minHandPresenceConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });

        if (!isActive) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        startCamera();
      } catch (err: any) {
        console.error("Error initializing MediaPipe:", err);
        setError(`Failed to load hand tracking: ${err.message}`);
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            // 480p is perfect for hand tracking and much faster than 720p/1080p
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            if (isActive) {
              setIsCameraReady(true);
              predictWebcam();
            }
          };
        }
      } catch (err) {
        console.error("Camera Error:", err);
        setError("Could not access camera.");
      }
    };

    const predictWebcam = () => {
      if (
        !videoRef.current ||
        !landmarkerRef.current ||
        !isActive ||
        !isTabVisible
      ) {
        requestRef.current = requestAnimationFrame(predictWebcam);
        return;
      }

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const startTimeMs = performance.now();

        // Standardized throttling to 30 FPS for all devices
        if (startTimeMs - lastDetectionTimeRef.current < DETECTION_INTERVAL) {
          requestRef.current = requestAnimationFrame(predictWebcam);
          return;
        }
        lastDetectionTimeRef.current = startTimeMs;

        try {
          const results = landmarkerRef.current.detectForVideo(
            video,
            startTimeMs
          );

          if (results.landmarks && results.landmarks.length > 0) {
            const ratio = video.videoWidth / video.videoHeight;
            const lm = results.landmarks[0];
            landmarksRef.current = lm;
            const count = countFingers(lm, ratio);

            // Add to history buffer for temporal smoothing
            fingerHistoryRef.current.push(count);
            if (fingerHistoryRef.current.length > HISTORY_SIZE) {
              fingerHistoryRef.current.shift();
            }

            // Use MODE (most frequent value) for stability
            const smoothedCount =
              fingerHistoryRef.current.length >= 3
                ? getMode(fingerHistoryRef.current)
                : count;

            // PERFORMANCE: Only update via callback if count actually changed
            // Removed state update to prevent high-frequency re-renders
            if (lastCountRef.current !== smoothedCount) {
              lastCountRef.current = smoothedCount;
              if (onCountUpdate) onCountUpdate(smoothedCount);
            }
          } else {
            landmarksRef.current = null;
            // Add 0 to history even when no hand detected for temporal smoothing
            fingerHistoryRef.current.push(0);
            if (fingerHistoryRef.current.length > HISTORY_SIZE) {
              fingerHistoryRef.current.shift();
            }

            const smoothedCount = getMode(fingerHistoryRef.current);
            if (lastCountRef.current !== smoothedCount) {
              lastCountRef.current = smoothedCount;
              if (onCountUpdate) onCountUpdate(smoothedCount);
            }
          }
        } catch (e) {
          console.warn("Detection failed this frame", e);
        }
      }
      requestRef.current = requestAnimationFrame(predictWebcam);
    };

    setupMediaPipe();

    return () => {
      isActive = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (landmarkerRef.current) landmarkerRef.current.close();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoRef]);

  return { isCameraReady, error, landmarksRef };
};
