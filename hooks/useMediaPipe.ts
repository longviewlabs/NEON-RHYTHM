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

export const useMediaPipe = (
  videoRef: React.RefObject<HTMLVideoElement | null>
) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [fingerCount, setFingerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);

  // Detect mobile for optimizations
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const DETECTION_INTERVAL = isMobile ? 66 : 0; // ~15 FPS detection on mobile is enough for rhythm, saves CPU

  // Temporal smoothing: store recent finger counts
  const fingerHistoryRef = useRef<number[]>([]);
  const HISTORY_SIZE = isMobile ? 3 : 5; // Smaller history for faster response on mobile

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

  // Helper: Calculate 3D distance between two landmarks
  const getDistance3D = (
    a: NormalizedLandmark,
    b: NormalizedLandmark,
    ratio: number = 1
  ): number => {
    // Standardize coordinates by multiplying X and Z by the aspect ratio (W/H)
    // This makes the distance metric consistent in "height units"
    return Math.hypot((a.x - b.x) * ratio, a.y - b.y, (a.z - b.z) * ratio);
  };

  // Helper: Calculate angle at point B given points A, B, C (in degrees) using 3D coordinates
  const getAngle = (
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

  // Helper: Count extended fingers using Robust Relative Distances (Rotation Invariant)
  const countFingers = (
    landmarks: NormalizedLandmark[],
    ratio: number
  ): number => {
    if (!landmarks || landmarks.length < 21) return 0;

    const wrist = landmarks[0];
    const PinkyMCP = landmarks[17];
    let count = 0;

    // --- THUMB (Points 2, 3, 4) ---
    // LOGIC: Is the thumb tip further from the pinky knuckle than the base joint?
    // This is the most robust way to detect a "tucked" thumb.
    const thumbIP = landmarks[3];
    const thumbTip = landmarks[4];

    const distTipToPinky = getDistance3D(thumbTip, PinkyMCP, ratio);
    const distIpToPinky = getDistance3D(thumbIP, PinkyMCP, ratio);

    // If tip is significantly further from pinky than the inner joint, it's "out"
    if (distTipToPinky > distIpToPinky * 1.1) {
      // Also check if it's not tucked deep into the palm
      const distTipToWrist = getDistance3D(thumbTip, wrist, ratio);
      const distMcpToWrist = getDistance3D(landmarks[2], wrist, ratio);
      if (distTipToWrist > distMcpToWrist * 0.8) {
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

      const distWristTip = getDistance3D(wrist, tip, ratio);
      const distWristMcp = getDistance3D(wrist, mcp, ratio);

      // LOGIC: Is the tip significantly "out" from the knuckle?
      // 1.35x distance is a safe "out of the fist" threshold
      if (distWristTip > distWristMcp * 1.35) {
        count++;
      }
    }

    return count;
  };

  useEffect(() => {
    let isActive = true;

    const setupMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );

        if (!isActive) return;

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: isMobile ? "CPU" : "GPU",
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
            width: { ideal: isMobile ? 480 : 1280 },
            height: { ideal: isMobile ? 360 : 720 },
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
      if (!videoRef.current || !landmarkerRef.current || !isActive) return;

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const startTimeMs = performance.now();

        // Throttle detection on mobile to save battery and reduce heat
        if (
          isMobile &&
          startTimeMs - lastDetectionTimeRef.current < DETECTION_INTERVAL
        ) {
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

            // Only update state if number changes to avoid re-renders
            setFingerCount((prev) =>
              prev === smoothedCount ? prev : smoothedCount
            );
          } else {
            landmarksRef.current = null;
            // Clear history when no hand detected
            fingerHistoryRef.current = [];
            setFingerCount(0);
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
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (landmarkerRef.current) landmarkerRef.current.close();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoRef]);

  return { isCameraReady, fingerCount, error, landmarksRef };
};
