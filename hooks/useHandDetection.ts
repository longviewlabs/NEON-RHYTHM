/**
 * Unified Hand Detection Hook - MediaPipe Only
 * Uses MediaPipe Tasks Vision for all platforms (desktop, iOS, Android)
 *
 * ARCHITECTURE:
 * - Single MediaPipe engine for all platforms
 * - Optimized for mobile with downscaled detection
 * - Minimal smoothing for instant response at high BPM
 */

import React, { useEffect, useRef, useState } from "react";
import {
  HandLandmarker,
  FilesetResolver,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// Re-export NormalizedLandmark for external use
export type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Detect mobile once outside the hook
const IS_MOBILE =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// ============== Shared Helpers ==============

const getDistanceSq3D = (
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  ratio: number = 1
): number => {
  const dx = (a.x - b.x) * ratio;
  const dy = a.y - b.y;
  const dz = (a.z - b.z) * ratio;
  return dx * dx + dy * dy + dz * dz;
};

export const countFingers = (
  landmarks: NormalizedLandmark[],
  ratio: number
): number => {
  if (!landmarks || landmarks.length < 21) return 0;

  const wrist = landmarks[0];
  const PinkyMCP = landmarks[17];
  let count = 0;

  // --- THUMB ---
  const thumbIP = landmarks[3];
  const thumbTip = landmarks[4];
  const indexMCP = landmarks[5];

  const distSqTipToPinky = getDistanceSq3D(thumbTip, PinkyMCP, ratio);
  const distSqIpToPinky = getDistanceSq3D(thumbIP, PinkyMCP, ratio);

  if (distSqTipToPinky > distSqIpToPinky * 1.3225) {
    const distSqTipToWrist = getDistanceSq3D(thumbTip, wrist, ratio);
    const distSqMcpToWrist = getDistanceSq3D(landmarks[2], wrist, ratio);
    const distSqTipToIndex = getDistanceSq3D(thumbTip, indexMCP, ratio);
    const distSqMcpToIndex = getDistanceSq3D(landmarks[2], indexMCP, ratio);

    if (
      distSqTipToWrist > distSqMcpToWrist * 0.7 &&
      distSqTipToIndex > distSqMcpToIndex * 1.1
    ) {
      count++;
    }
  }

  // --- FINGERS ---
  const fingers = [
    { mcp: 5, tip: 8 },
    { mcp: 9, tip: 12 },
    { mcp: 13, tip: 16 },
    { mcp: 17, tip: 20 },
  ];

  for (const f of fingers) {
    const mcp = landmarks[f.mcp];
    const tip = landmarks[f.tip];
    const distSqWristTip = getDistanceSq3D(wrist, tip, ratio);
    const distSqWristMcp = getDistanceSq3D(wrist, mcp, ratio);
    if (distSqWristTip > distSqWristMcp * 1.8225) {
      count++;
    }
  }

  return count;
};

const getMode = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  let maxFreq = 0;
  let mode = arr[0];
  for (let i = 0; i < arr.length; i++) {
    let c = 0;
    for (let j = 0; j < arr.length; j++) {
      if (arr[i] === arr[j]) c++;
    }
    if (c > maxFreq) {
      maxFreq = c;
      mode = arr[i];
    }
  }
  return mode;
};

// ============== Unified Hook (MediaPipe Only) ==============

// ============== Unified Hook (MediaPipe Only) ==============

export const useHandDetection = (
  onCountUpdate?: (count: number) => void,
  currentBpm?: number,
  enabled: boolean = true
) => {
  const [error, setError] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [isTrackingReady, setIsTrackingReady] = useState(false);

  // Shared refs
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const fingerCountRef = useRef<number>(0);
  const lastCountRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);
  const fingerHistoryRef = useRef<number[]>([]);
  const lastDetectionTimeRef = useRef<number>(0);

  // Tracking-specific refs (hidden stream)
  const trackingVideoRef = useRef<HTMLVideoElement | null>(null);

  // Track model ready state
  const isModelReadyRef = useRef<boolean>(false);
  const currentBpmRef = useRef<number | undefined>(currentBpm);

  // Throttling: 15-20 FPS (50-66ms) is optimal for mobile CPU/battery
  const DETECTION_INTERVAL = IS_MOBILE ? 55 : 40;

  // Update BPM ref when prop changes
  useEffect(() => {
    currentBpmRef.current = currentBpm;
  }, [currentBpm]);

  // Minimal smoothing for maximum responsiveness
  const getHistorySize = (bpm: number | undefined): number => {
    if (!bpm) return IS_MOBILE ? 3 : 5;
    if (bpm >= 130) return 1; // No smoothing at high BPM - instant response
    if (bpm >= 110) return 2;
    return IS_MOBILE ? 3 : 5;
  };

  // ============== MediaPipe Setup (Once) ==============
  useEffect(() => {
    let isActive = true;

    const setupMediaPipe = async () => {
      try {
        setIsModelLoading(true);
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );

        if (!isActive) return;

        let landmarker: HandLandmarker | null = null;
        const delegates = IS_MOBILE ? ["CPU"] : ["GPU", "CPU"];

        for (const delegate of delegates) {
          try {
            landmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: delegate as "GPU" | "CPU",
              },
              runningMode: "VIDEO",
              numHands: 1,
              minHandDetectionConfidence: 0.4,
              minHandPresenceConfidence: 0.4,
              minTrackingConfidence: 0.4,
            });
            break;
          } catch (delegateError) {
            if (delegate === delegates[delegates.length - 1])
              throw delegateError;
          }
        }

        if (!isActive) {
          landmarker?.close();
          return;
        }

        landmarkerRef.current = landmarker;
        isModelReadyRef.current = true;
        setIsModelLoading(false);
      } catch (err: any) {
        setError(`Failed to load MediaPipe: ${err.message}`);
        setIsModelLoading(false);
      }
    };

    setupMediaPipe();

    return () => {
      isActive = false;
      isModelReadyRef.current = false;
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
    };
  }, []);

  // ============== Tracking Loop Control (Based on enabled) ==============
  useEffect(() => {
    if (!enabled) {
      setIsTrackingReady(false);
      landmarksRef.current = null;
      return;
    }

    let isActive = true;
    let isTabVisible = true;

    // Create a hidden video element for tracking if it doesn't exist
    if (!trackingVideoRef.current) {
      const v = document.createElement("video");
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;
      v.style.display = "none";
      v.style.position = "absolute";
      v.style.width = "320px";
      v.style.height = "240px";
      v.style.opacity = "0";
      trackingVideoRef.current = v;
      document.body.appendChild(v);
    }

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const startTrackingCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 320 },
            height: { ideal: 240 },
            frameRate: { ideal: 30 },
          },
        });

        if (trackingVideoRef.current && isActive) {
          trackingVideoRef.current.srcObject = stream;
          trackingVideoRef.current.onloadeddata = () => {
            if (isActive && trackingVideoRef.current) {
              setIsTrackingReady(true);
              startLoop();
            }
          };
          await trackingVideoRef.current.play();
        }
      } catch (err) {
        console.error("Tracking Camera Error:", err);
        setError("Could not access camera for tracking.");
      }
    };

    const predictWebcam = async () => {
      const trackingVideo = trackingVideoRef.current;
      if (
        !trackingVideo ||
        !landmarkerRef.current ||
        !isActive ||
        !isTabVisible ||
        isProcessingRef.current ||
        !isModelReadyRef.current
      ) {
        scheduleNextFrame();
        return;
      }

      const startTimeMs = performance.now();
      if (startTimeMs - lastDetectionTimeRef.current < DETECTION_INTERVAL) {
        scheduleNextFrame();
        return;
      }

      if (trackingVideo.readyState < 2) {
        scheduleNextFrame();
        return;
      }

      lastDetectionTimeRef.current = startTimeMs;
      isProcessingRef.current = true;

      try {
        let currentCount = 0;
        const ratio = trackingVideo.videoWidth / trackingVideo.videoHeight;
        const results = landmarkerRef.current.detectForVideo(
          trackingVideo,
          performance.now()
        );

        if (results.landmarks && results.landmarks.length > 0) {
          landmarksRef.current = results.landmarks[0];
          currentCount = countFingers(results.landmarks[0], ratio);
        } else {
          landmarksRef.current = null;
        }

        const historySize = getHistorySize(currentBpmRef.current);
        fingerHistoryRef.current.push(currentCount);
        if (fingerHistoryRef.current.length > historySize) {
          fingerHistoryRef.current.shift();
        }

        const smoothedCount =
          fingerHistoryRef.current.length >= 2
            ? getMode(fingerHistoryRef.current)
            : currentCount;

        fingerCountRef.current = smoothedCount;
        if (lastCountRef.current !== smoothedCount) {
          lastCountRef.current = smoothedCount;
          if (onCountUpdate) onCountUpdate(smoothedCount);
        }
      } catch (e) {
        console.warn("Detection error:", e);
      } finally {
        isProcessingRef.current = false;
      }

      scheduleNextFrame();
    };

    const scheduleNextFrame = () => {
      if (!isActive) return;
      const trackingVideo = trackingVideoRef.current;
      if (trackingVideo && (trackingVideo as any).requestVideoFrameCallback) {
        (trackingVideo as any).requestVideoFrameCallback(predictWebcam);
      } else {
        requestRef.current = requestAnimationFrame(() => predictWebcam());
      }
    };

    const startLoop = () => {
      scheduleNextFrame();
    };

    startTrackingCamera();

    return () => {
      isActive = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);

      if (trackingVideoRef.current) {
        const video = trackingVideoRef.current;
        if (video.srcObject) {
          const stream = video.srcObject as MediaStream;
          stream.getTracks().forEach((t) => t.stop());
          video.srcObject = null;
        }
        if (video.parentNode) {
          video.parentNode.removeChild(video);
        }
        trackingVideoRef.current = null;
      }
    };
  }, [enabled]);

  return {
    isTrackingReady,
    error,
    landmarksRef,
    fingerCountRef,
    isModelLoading,
  };
};
