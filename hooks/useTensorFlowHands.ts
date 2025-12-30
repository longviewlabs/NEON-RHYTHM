/**
 * TensorFlow.js Hand Pose Detection Hook
 * Alternative to MediaPipe for comparison
 */

import React, { useEffect, useRef, useState } from "react";

// Types for TensorFlow hand detection
interface Keypoint {
  x: number;
  y: number;
  z?: number;
  name?: string;
}

interface Hand {
  keypoints: Keypoint[];
  keypoints3D?: Keypoint[];
  handedness: string;
  score: number;
}

// Normalized landmark type (same as MediaPipe for compatibility)
interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

// Detect mobile once outside the hook
const IS_MOBILE =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Helper: Calculate Squared 3D distance
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

// Helper: Count extended fingers (same logic as MediaPipe)
const countFingers = (
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
    if (distSqWristTip > distSqWristMcp * 1.8225) {
      count++;
    }
  }

  return count;
};

export const useTensorFlowHands = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onCountUpdate?: (count: number) => void
) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(true);

  const detectorRef = useRef<any>(null);
  const requestRef = useRef<number>(0);
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const fingerCountRef = useRef<number>(0);
  const lastDetectionTimeRef = useRef<number>(0);
  const lastCountRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);

  // Throttling: TensorFlow.js is generally faster, can run more often
  const DETECTION_INTERVAL = IS_MOBILE ? 45 : 35;

  // Temporal smoothing
  const fingerHistoryRef = useRef<number[]>([]);
  const HISTORY_SIZE = IS_MOBILE ? 3 : 5;

  const getMode = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    let maxFreq = 0;
    let mode = arr[0];
    for (let i = 0; i < arr.length; i++) {
      let count = 0;
      for (let j = 0; j < arr.length; j++) {
        if (arr[i] === arr[j]) count++;
      }
      if (count > maxFreq) {
        maxFreq = count;
        mode = arr[i];
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

    const setupTensorFlow = async () => {
      try {
        setIsModelLoading(true);
        console.log("TensorFlow.js: Loading model...");

        // Dynamic imports to avoid bundling if not used
        const tf = await import("@tensorflow/tfjs");
        const handPoseDetection = await import(
          "@tensorflow-models/hand-pose-detection"
        );

        // Set backend
        await tf.setBackend("webgl");
        await tf.ready();
        console.log("TensorFlow.js: Backend ready:", tf.getBackend());

        if (!isActive) return;

        // Create detector with MediaPipeHands model (same landmarks as MediaPipe!)
        // Always use "lite" model (complexity 0) for better performance in rhythm games
        const model = handPoseDetection.SupportedModels.MediaPipeHands;
        const detector = await handPoseDetection.createDetector(model, {
          runtime: "tfjs",
          modelType: "lite", // Complexity 0 - faster inference, good enough for finger counting
          maxHands: 1,
        });

        if (!isActive) {
          detector.dispose();
          return;
        }

        detectorRef.current = detector;
        setIsModelLoading(false);
        console.log("TensorFlow.js: Hand detector ready");
      } catch (err: any) {
        console.error("Error initializing TensorFlow.js:", err);
        setError(`Failed to load TensorFlow.js: ${err.message}`);
        setIsModelLoading(false);
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            if (isActive) {
              setIsCameraReady(true);
              startLoop();
            }
          };
        }
      } catch (err) {
        console.error("Camera Error:", err);
        setError("Could not access camera.");
      }
    };

    const predictWebcam = async (time?: number) => {
      if (
        !videoRef.current ||
        !detectorRef.current ||
        !isActive ||
        !isTabVisible ||
        isProcessingRef.current
      ) {
        scheduleNextFrame();
        return;
      }

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const startTimeMs = time || performance.now();

        if (startTimeMs - lastDetectionTimeRef.current < DETECTION_INTERVAL) {
          scheduleNextFrame();
          return;
        }
        lastDetectionTimeRef.current = startTimeMs;
        isProcessingRef.current = true;

        try {
          // TensorFlow.js estimateHands
          const hands: Hand[] = await detectorRef.current.estimateHands(video, {
            flipHorizontal: false,
          });

          let currentCount = 0;
          if (hands && hands.length > 0) {
            const hand = hands[0];
            const ratio = video.videoWidth / video.videoHeight;

            // Convert keypoints to normalized landmarks
            const landmarks: NormalizedLandmark[] = hand.keypoints.map(
              (kp: Keypoint) => ({
                x: kp.x / video.videoWidth,
                y: kp.y / video.videoHeight,
                z: hand.keypoints3D
                  ? (hand.keypoints3D.find((k: Keypoint) => k.name === kp.name)
                      ?.z || 0)
                  : 0,
              })
            );

            landmarksRef.current = landmarks;
            currentCount = countFingers(landmarks, ratio);
            console.log("TF.js: Hand detected! Finger count:", currentCount);
          } else {
            landmarksRef.current = null;
          }

          fingerHistoryRef.current.push(currentCount);
          if (fingerHistoryRef.current.length > HISTORY_SIZE) {
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
          console.warn("TF.js Detection stalled", e);
        } finally {
          isProcessingRef.current = false;
        }
      }
      scheduleNextFrame();
    };

    const scheduleNextFrame = () => {
      if (!isActive) return;
      const video = videoRef.current;
      if (video && (video as any).requestVideoFrameCallback) {
        (video as any).requestVideoFrameCallback(predictWebcam);
      } else {
        requestRef.current = requestAnimationFrame(() => predictWebcam());
      }
    };

    const startLoop = () => {
      scheduleNextFrame();
    };

    setupTensorFlow();
    startCamera();

    return () => {
      isActive = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (detectorRef.current) {
        detectorRef.current.dispose();
      }
      if (videoRef.current) {
        const video = videoRef.current;
        if (video.srcObject) {
          const stream = video.srcObject as MediaStream;
          stream.getTracks().forEach((t) => t.stop());
        }
      }
    };
  }, [videoRef]);

  return { isCameraReady, error, landmarksRef, fingerCountRef, isModelLoading };
};

