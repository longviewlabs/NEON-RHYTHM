/**
 * Unified Hand Detection Hook
 * Supports both MediaPipe and TensorFlow.js backends
 * 
 * ARCHITECTURE:
 * - TensorFlow.js runs in a Web Worker (off main thread)
 * - Maximum detection rate - no throttling for best accuracy
 * - Minimal smoothing for instant response at high BPM
 */

import React, { useEffect, useRef, useState } from "react";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type DetectionEngine = "mediapipe" | "tensorflow";

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

// ============== Unified Hook ==============

export const useHandDetection = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  engine: DetectionEngine = "mediapipe",
  onCountUpdate?: (count: number) => void,
  currentBpm?: number
) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [currentEngine, setCurrentEngine] = useState<DetectionEngine>(engine);

  // Shared refs
  const detectorRef = useRef<any>(null);
  const requestRef = useRef<number>(0);
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const fingerCountRef = useRef<number>(0);
  const lastCountRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);
  const fingerHistoryRef = useRef<number[]>([]);
  
  // Track actual active engine (ref for use in detection loop)
  const activeEngineRef = useRef<DetectionEngine>(engine);
  const isModelReadyRef = useRef<boolean>(false);
  const currentBpmRef = useRef<number | undefined>(currentBpm);
  
  // Worker refs for TensorFlow.js detection
  const workerRef = useRef<Worker | null>(null);
  const pendingDetectionsRef = useRef<Map<number, (landmarks: NormalizedLandmark[] | null) => void>>(new Map());
  const frameIdRef = useRef<number>(0);

  // Update BPM ref when prop changes
  useEffect(() => {
    currentBpmRef.current = currentBpm;
  }, [currentBpm]);

  // Minimal smoothing for maximum responsiveness
  // Since detection runs in worker, we can afford less smoothing
  const getHistorySize = (bpm: number | undefined): number => {
    if (!bpm) return 2;
    if (bpm >= 130) return 1; // No smoothing at high BPM - instant response
    if (bpm >= 110) return 2;
    return 2;
  };

  useEffect(() => {
    let isActive = true;
    let isTabVisible = true;

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // ============== MediaPipe Setup ==============
    const setupMediaPipe = async () => {
      try {
        setIsModelLoading(true);
        console.log("[MediaPipe] Initializing...");

        const { FilesetResolver, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );

        if (!isActive) return;

        // Try GPU delegate first (faster), fallback to CPU/WASM if it fails
        let landmarker: any = null;
        const delegates = IS_MOBILE ? ["CPU"] : ["GPU", "CPU"]; // Mobile: WASM is more stable

        for (const delegate of delegates) {
          try {
            console.log(`[MediaPipe] Trying ${delegate} delegate...`);
            // Note: MediaPipe Tasks API doesn't expose modelComplexity parameter
            // Using lowered confidence thresholds for faster detection
            landmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: delegate as "GPU" | "CPU",
              },
              runningMode: "VIDEO",
              numHands: 1,
              minHandDetectionConfidence: 0.4, // Lowered for faster detection
              minHandPresenceConfidence: 0.4,
              minTrackingConfidence: 0.4,
            });
            console.log(`[MediaPipe] Successfully initialized with ${delegate} delegate`);
            break; // Success, exit loop
          } catch (delegateError) {
            console.warn(`[MediaPipe] ${delegate} delegate failed:`, delegateError);
            if (delegate === delegates[delegates.length - 1]) {
              throw delegateError; // Last option failed, throw error
            }
          }
        }

        if (!isActive) {
          landmarker?.close();
          return;
        }

        detectorRef.current = landmarker;
        activeEngineRef.current = "mediapipe";
        isModelReadyRef.current = true;
        setCurrentEngine("mediapipe");
        setIsModelLoading(false);
        console.log("[MediaPipe] Ready for detection");
      } catch (err: any) {
        console.error("Error initializing MediaPipe:", err);
        setError(`Failed to load MediaPipe: ${err.message}`);
        setIsModelLoading(false);
      }
    };

    // ============== TensorFlow.js Setup (Main Thread - Fallback) ==============
    const setupTensorFlowMainThread = async () => {
      try {
        setIsModelLoading(true);
        console.log("[Main] Loading TensorFlow.js on main thread (fallback)...");

        // Dynamic imports for TensorFlow.js
        const tf = await import("@tensorflow/tfjs");
        const handPoseDetection = await import(
          "@tensorflow-models/hand-pose-detection"
        );

        // Set backend to WebGL for GPU acceleration
        await tf.setBackend("webgl");
        await tf.ready();
        console.log("[Main] TensorFlow.js backend ready:", tf.getBackend());

        if (!isActive) return;

        // Create detector with MediaPipeHands model using tfjs runtime
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
        activeEngineRef.current = "tensorflow";
        isModelReadyRef.current = true;
        setCurrentEngine("tensorflow");
        setIsModelLoading(false);
        console.log("[Main] TensorFlow.js detector ready (main thread)");
      } catch (err: any) {
        console.error("Error initializing TensorFlow.js on main thread:", err);
        setError(`Failed to load TensorFlow.js: ${err.message}`);
        setIsModelLoading(false);
      }
    };

    // ============== TensorFlow.js Setup (using Web Worker) ==============
    const setupTensorFlow = async () => {
      try {
        setIsModelLoading(true);

        // Check if OffscreenCanvas is supported (required for WebGL in workers)
        if (typeof OffscreenCanvas === "undefined") {
          console.warn("OffscreenCanvas not supported, falling back to TensorFlow.js on main thread");
          await setupTensorFlowMainThread();
          return;
        }

        // Initialize worker for TensorFlow.js detection
        const worker = new Worker(
          new URL("./handDetection.worker.ts", import.meta.url),
          { type: "module" }
        );

        worker.onmessage = (event) => {
          const { type, payload } = event.data;

          if (type === "ready") {
            activeEngineRef.current = "tensorflow";
            isModelReadyRef.current = true;
            detectorRef.current = "worker" as any; // Mark detector as ready for worker mode
            setCurrentEngine("tensorflow");
            setIsModelLoading(false);
            console.log("[Main] TensorFlow.js worker ready");
          } else if (type === "detection") {
            const { landmarks, frameId } = payload;
            const callback = pendingDetectionsRef.current.get(frameId);
            if (callback) {
              callback(landmarks);
              pendingDetectionsRef.current.delete(frameId);
            }
          } else if (type === "error") {
            console.error("[Main] Worker error:", payload.message);
            console.warn("Falling back to TensorFlow.js on main thread (faster than MediaPipe)");
            setError(`Worker error: ${payload.message}`);
            setIsModelLoading(false);
            // Fallback to TensorFlow.js on main thread (faster than MediaPipe)
            worker.terminate();
            workerRef.current = null;
            setupTensorFlowMainThread(); // Fire and forget - no await needed
          }
        };

        worker.onerror = (err) => {
          console.error("[Main] Worker initialization error:", err);
          console.warn("Falling back to TensorFlow.js on main thread");
          setError("Failed to initialize detection worker");
          setIsModelLoading(false);
          worker.terminate();
          workerRef.current = null;
          // Fallback to TensorFlow.js on main thread
          setupTensorFlowMainThread(); // Fire and forget - no await needed
        };

        workerRef.current = worker;
        
        // Initialize detector in worker
        worker.postMessage({ type: "init" });

        if (!isActive) {
          worker.terminate();
          workerRef.current = null;
          return;
        }
      } catch (err: any) {
        console.error("Error initializing TensorFlow.js worker:", err);
        console.warn("Falling back to TensorFlow.js on main thread");
        setIsModelLoading(false);
        await setupTensorFlowMainThread();
      }
    };

    // ============== Camera Setup ==============
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

    // ============== Detection Loop (Maximum Rate - Worker handles heavy lifting) ==============
    const predictWebcam = async (time?: number) => {
      if (
        !videoRef.current ||
        !detectorRef.current ||
        !isActive ||
        !isTabVisible ||
        isProcessingRef.current ||
        !isModelReadyRef.current
      ) {
        scheduleNextFrame();
        return;
      }

      const video = videoRef.current;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        scheduleNextFrame();
        return;
      }
      
      // No throttling - run detection as fast as possible
      // Worker handles the heavy computation off main thread
      isProcessingRef.current = true;

      try {
        let currentCount = 0;
        const ratio = video.videoWidth / video.videoHeight;

        if (activeEngineRef.current === "mediapipe") {
          // MediaPipe can use video element directly - more efficient than ImageBitmap
          const results = detectorRef.current.detectForVideo(
            video,
            performance.now()
          );

          if (results.landmarks && results.landmarks.length > 0) {
            landmarksRef.current = results.landmarks[0];
            currentCount = countFingers(results.landmarks[0], ratio);
          } else {
            landmarksRef.current = null;
          }
        } else {
          // TensorFlow.js detection (worker or main thread)
          if (workerRef.current && isModelReadyRef.current) {
            // Using Web Worker
            const frameId = frameIdRef.current++;
            
            // Create ImageBitmap from video frame (downscaled for performance)
            const bitmap = await createImageBitmap(video, {
              resizeWidth: 320,
              resizeHeight: 240,
              resizeQuality: "low",
            });

            // Send to worker for detection
            const landmarks = await new Promise<NormalizedLandmark[] | null>((resolve) => {
              pendingDetectionsRef.current.set(frameId, resolve);
              
              // Send detection request to worker
              workerRef.current!.postMessage(
                {
                  type: "detect",
                  payload: {
                    videoBitmap: bitmap,
                    videoWidth: 320,
                    videoHeight: 240,
                    frameId,
                  },
                },
                [bitmap] // Transfer bitmap ownership to worker
              );

              // Timeout fallback (prevent hanging)
              setTimeout(() => {
                if (pendingDetectionsRef.current.has(frameId)) {
                  pendingDetectionsRef.current.delete(frameId);
                  resolve(null);
                }
              }, 1000);
            });

            if (landmarks && landmarks.length >= 21) {
              landmarksRef.current = landmarks;
              currentCount = countFingers(landmarks, ratio);
            } else {
              landmarksRef.current = null;
            }
          } else if (detectorRef.current && isModelReadyRef.current) {
            // Using TensorFlow.js on main thread (fallback)
            // TensorFlow.js with tfjs runtime requires a canvas, not video element
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              
              const hands = await detectorRef.current.estimateHands(canvas, {
              flipHorizontal: false,
            });

            if (hands && hands.length > 0) {
              const hand = hands[0];
              // Convert keypoints to normalized landmarks
                const landmarks: NormalizedLandmark[] = hand.keypoints.map(
                  (kp: any, index: number) => ({
                    x: kp.x / video.videoWidth,
                    y: kp.y / video.videoHeight,
                    z: hand.keypoints3D?.[index]?.z ?? 0,
                  })
                );

              landmarksRef.current = landmarks;
              currentCount = countFingers(landmarks, ratio);
            } else {
                landmarksRef.current = null;
              }
            }
          } else {
          // Model not ready yet, skip this frame
          landmarksRef.current = null;
        }
        }

        // Smoothing
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

    // Initialize based on selected engine
    if (engine === "tensorflow") {
      setupTensorFlow();
    } else {
      setupMediaPipe();
    }
    startCamera();

    return () => {
      isActive = false;
      isModelReadyRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);

      // Cleanup detector (use ref for actual engine type)
      if (detectorRef.current) {
        if (activeEngineRef.current === "mediapipe") {
          detectorRef.current.close?.();
        } else {
          detectorRef.current.dispose?.();
        }
        detectorRef.current = null;
      }

      // Cleanup worker
      if (workerRef.current) {
        workerRef.current.postMessage({ type: "terminate" });
        workerRef.current.terminate();
        workerRef.current = null;
      }
      
      // Clear pending detections
      pendingDetectionsRef.current.clear();

      // Cleanup camera
      if (videoRef.current) {
        const video = videoRef.current;
        if (video.srcObject) {
          const stream = video.srcObject as MediaStream;
          stream.getTracks().forEach((t) => t.stop());
        }
      }
    };
  }, [videoRef, engine]);

  return {
    isCameraReady,
    error,
    landmarksRef,
    fingerCountRef,
    isModelLoading,
    currentEngine,
  };
};

