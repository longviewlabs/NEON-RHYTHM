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
    b: NormalizedLandmark
  ): number => {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  };

  // Helper: Calculate angle at point B given points A, B, C (in degrees) using 3D coordinates
  const getAngle = (
    a: NormalizedLandmark,
    b: NormalizedLandmark,
    c: NormalizedLandmark
  ): number => {
    // Vectors AB and CB
    const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };

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
  const countFingers = (landmarks: NormalizedLandmark[]): number => {
    if (!landmarks || landmarks.length < 21) return 0;

    const wrist = landmarks[0];
    const indexMCP = landmarks[5];
    let count = 0;

    // --- THUMB (Points 1, 2, 3, 4) ---
    const thumbMCP = landmarks[2];
    const thumbIP = landmarks[3];
    const thumbTip = landmarks[4];

    // 1. Angle Check: Thumb must be relatively straight
    const thumbAngle = getAngle(thumbMCP, thumbIP, thumbTip);

    // 2. Wide Check: Thumb Tip must be further from Index-MCP than the IP joint is
    const distTipToIndex = getDistance3D(thumbTip, indexMCP);
    const distIpToIndex = getDistance3D(thumbIP, indexMCP);

    const isThumbStraight = thumbAngle > 150;
    const isThumbOut = distTipToIndex > distIpToIndex * 1.2;

    if (isThumbStraight && isThumbOut) {
      count++;
    }

    // --- FINGERS (Index, Middle, Ring, Pinky) ---
    const fingers = [
      { name: "index", mcp: 5, pip: 6, tip: 8 },
      { name: "middle", mcp: 9, pip: 10, tip: 12 },
      { name: "ring", mcp: 13, pip: 14, tip: 16 },
      { name: "pinky", mcp: 17, pip: 18, tip: 20 },
    ];

    for (const f of fingers) {
      const mcp = landmarks[f.mcp];
      const pip = landmarks[f.pip];
      const tip = landmarks[f.tip];

      // ROBUST CHECK: Is the Tip further from the Wrist than the PIP joint?
      const distWristTip = getDistance3D(wrist, tip);
      const distWristPip = getDistance3D(wrist, pip);
      const distWristMcp = getDistance3D(wrist, mcp);

      // 1. Tip must be further than PIP (Principal Check)
      const isTipExtended = distWristTip > distWristPip;

      // 2. Tip must also be significantly further than MCP
      const isTipFarFromPalm = distWristTip > distWristMcp * 1.3;

      // 3. Angle Check (Secondary to filter noise)
      const angle = getAngle(mcp, pip, tip);
      const isStraight = angle > 100;

      if (isTipExtended && isTipFarFromPalm && isStraight) {
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
            delegate: "GPU",
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
            const lm = results.landmarks[0];
            landmarksRef.current = lm;
            const count = countFingers(lm);

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
