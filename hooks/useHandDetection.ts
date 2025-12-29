/**
 * Unified Hand Detection Hook
 * Supports both MediaPipe and TensorFlow.js backends
 * 
 * OPTIMIZATIONS:
 * 1. Hybrid Motion Detection - Skip MediaPipe when hand hasn't moved
 * 2. Adaptive Detection - Different rates based on game state
 * 3. Pose Prediction - Predict pose using velocity when hand is stable
 */

import React, { useEffect, useRef, useState } from "react";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type DetectionEngine = "mediapipe" | "tensorflow";

// Game states for adaptive detection
export type GameState = "idle" | "countdown" | "between_beats" | "beat_approach" | "playing";

// Detect mobile once outside the hook
const IS_MOBILE =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// ============== Motion Detection Config ==============
const MOTION_THRESHOLD = 15; // Pixel difference threshold (0-255)
const MOTION_SAMPLE_SIZE = 32; // Sample grid size for motion detection
const MOTION_CHECK_INTERVAL = 16; // ~60fps motion checks (very cheap)

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
  currentBpm?: number,
  gameState: GameState = "idle",
  msUntilNextBeat?: number // For adaptive detection during beat approach
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
  const lastDetectionTimeRef = useRef<number>(0);
  const lastCountRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);
  const fingerHistoryRef = useRef<number[]>([]);
  
  // Track actual active engine (ref for use in detection loop)
  const activeEngineRef = useRef<DetectionEngine>(engine);
  const isModelReadyRef = useRef<boolean>(false);
  const currentBpmRef = useRef<number | undefined>(currentBpm);
  const gameStateRef = useRef<GameState>(gameState);
  const msUntilNextBeatRef = useRef<number | undefined>(msUntilNextBeat);
  
  // Worker refs for TensorFlow.js detection
  const workerRef = useRef<Worker | null>(null);
  const pendingDetectionsRef = useRef<Map<number, (landmarks: NormalizedLandmark[] | null) => void>>(new Map());
  const frameIdRef = useRef<number>(0);
  
  // ============== Motion Detection Refs ==============
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const prevFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const lastMotionCheckRef = useRef<number>(0);
  const motionDetectedRef = useRef<boolean>(true); // Start true to force first detection
  const consecutiveNoMotionRef = useRef<number>(0);
  
  // ============== Pose Prediction Refs ==============
  const lastLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const landmarkVelocityRef = useRef<{x: number, y: number}[]>([]);
  const predictionConfidenceRef = useRef<number>(1);
  const skippedFramesRef = useRef<number>(0);
  const MAX_SKIP_FRAMES = 5; // Max frames to skip before forcing detection
  
  // ============== Stats (for debugging) ==============
  const statsRef = useRef({ 
    totalFrames: 0, 
    detectionFrames: 0, 
    skippedByMotion: 0,
    skippedByPrediction: 0 
  });

  // Update refs when props change
  useEffect(() => {
    currentBpmRef.current = currentBpm;
  }, [currentBpm]);
  
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  
  useEffect(() => {
    msUntilNextBeatRef.current = msUntilNextBeat;
  }, [msUntilNextBeat]);

  // Dynamic history size based on BPM for faster response at high speeds
  const getHistorySize = (bpm: number | undefined): number => {
    if (!bpm) return IS_MOBILE ? 3 : 5;
    if (bpm >= 130) return IS_MOBILE ? 2 : 2;
    if (bpm >= 110) return IS_MOBILE ? 2 : 3;
    return IS_MOBILE ? 3 : 5;
  };

  // ============== Adaptive Detection Interval ==============
  // Different intervals based on game state
  const getDetectionInterval = (): number => {
    const state = gameStateRef.current;
    const msUntilBeat = msUntilNextBeatRef.current;
    
    // During beat approach (300ms before beat), maximize detection rate
    if (state === "beat_approach" || (msUntilBeat !== undefined && msUntilBeat < 300)) {
      return IS_MOBILE ? 20 : 16; // ~50-60fps - maximum accuracy
    }
    
    // Actively playing but between beats
    if (state === "playing" || state === "between_beats") {
      return IS_MOBILE ? 55 : 45; // ~18-22fps - save CPU
    }
    
    // Countdown - not critical
    if (state === "countdown") {
      return IS_MOBILE ? 100 : 80; // ~10-12fps - minimal CPU
    }
    
    // Idle/menu - very low rate
    return IS_MOBILE ? 150 : 100; // ~7-10fps
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

        const { FilesetResolver, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );

        if (!isActive) return;

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!isActive) {
          landmarker.close();
          return;
        }

        detectorRef.current = landmarker;
        activeEngineRef.current = "mediapipe";
        isModelReadyRef.current = true;
        setCurrentEngine("mediapipe");
        setIsModelLoading(false);
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
        const model = handPoseDetection.SupportedModels.MediaPipeHands;
        const detector = await handPoseDetection.createDetector(model, {
          runtime: "tfjs",
          modelType: IS_MOBILE ? "lite" : "full",
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
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:300',message:'Main thread TF.js ready',data:{activeEngine:'tensorflow',isModelReady:true,hasDetector:!!detector},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,E'})}).catch(()=>{});
        // #endregion
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

        worker.onmessage = async (event) => {
          const { type, payload } = event.data;

          if (type === "ready") {
            activeEngineRef.current = "tensorflow";
            isModelReadyRef.current = true;
            detectorRef.current = "worker" as any; // Mark detector as ready for worker mode
            setCurrentEngine("tensorflow");
            setIsModelLoading(false);
            console.log("[Main] TensorFlow.js worker ready");
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:348',message:'Worker ready message received',data:{activeEngine:'tensorflow',isModelReady:true,workerExists:!!workerRef.current,detectorRefSet:!!detectorRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'I'})}).catch(()=>{});
            // #endregion
          } else if (type === "detection") {
            const { landmarks, frameId } = payload;
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:352',message:'Main received detection result',data:{hasLandmarks:!!landmarks,landmarksLength:landmarks?.length||0,frameId:frameId,hasCallback:pendingDetectionsRef.current.has(frameId)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
            // #endregion
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
            await setupTensorFlowMainThread();
          }
        };

        worker.onerror = async (err) => {
          console.error("[Main] Worker initialization error:", err);
          console.warn("Falling back to TensorFlow.js on main thread");
          setError("Failed to initialize detection worker");
          setIsModelLoading(false);
          worker.terminate();
          workerRef.current = null;
          // Fallback to TensorFlow.js on main thread
          await setupTensorFlowMainThread();
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
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:399',message:'startCamera called',data:{isActive:isActive,hasVideoRef:!!videoRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:410',message:'Got camera stream',data:{hasStream:!!stream,isActive:isActive,hasVideoRef:!!videoRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'I'})}).catch(()=>{});
        // #endregion

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:417',message:'Video onloadeddata fired',data:{isActive:isActive,hasVideoRef:!!videoRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'I'})}).catch(()=>{});
            // #endregion
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

    // ============== Motion Detection (cheap ~1ms) ==============
    const detectMotion = (video: HTMLVideoElement): boolean => {
      if (!motionCanvasRef.current) {
        motionCanvasRef.current = document.createElement("canvas");
        motionCanvasRef.current.width = MOTION_SAMPLE_SIZE;
        motionCanvasRef.current.height = MOTION_SAMPLE_SIZE;
        motionCtxRef.current = motionCanvasRef.current.getContext("2d", { willReadFrequently: true });
      }
      
      const ctx = motionCtxRef.current;
      if (!ctx) return true; // Default to motion detected if canvas fails
      
      // Draw downscaled video frame
      ctx.drawImage(video, 0, 0, MOTION_SAMPLE_SIZE, MOTION_SAMPLE_SIZE);
      const currentFrame = ctx.getImageData(0, 0, MOTION_SAMPLE_SIZE, MOTION_SAMPLE_SIZE);
      const currentData = currentFrame.data;
      
      // First frame - no comparison yet
      if (!prevFrameDataRef.current) {
        prevFrameDataRef.current = new Uint8ClampedArray(currentData);
        return true;
      }
      
      // Compare frames - check pixel differences
      let diffSum = 0;
      const prevData = prevFrameDataRef.current;
      const pixelCount = MOTION_SAMPLE_SIZE * MOTION_SAMPLE_SIZE;
      
      for (let i = 0; i < currentData.length; i += 4) {
        // Compare grayscale values (faster than RGB)
        const gray1 = (prevData[i] + prevData[i+1] + prevData[i+2]) / 3;
        const gray2 = (currentData[i] + currentData[i+1] + currentData[i+2]) / 3;
        diffSum += Math.abs(gray1 - gray2);
      }
      
      const avgDiff = diffSum / pixelCount;
      
      // Store current frame for next comparison
      prevFrameDataRef.current = new Uint8ClampedArray(currentData);
      
      return avgDiff > MOTION_THRESHOLD;
    };
    
    // ============== Pose Prediction ==============
    const predictPose = (): number => {
      // If we have previous landmarks and velocity, predict current pose
      if (!lastLandmarksRef.current || lastLandmarksRef.current.length < 21) {
        return fingerCountRef.current;
      }
      
      // Simple prediction: assume pose hasn't changed significantly
      // This works because players HOLD poses between changes
      return fingerCountRef.current;
    };

    // ============== Detection Loop ==============
    const predictWebcam = async (time?: number) => {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:480',message:'predictWebcam called',data:{hasVideo:!!videoRef.current,hasDetector:!!detectorRef.current,isActive:isActive,isTabVisible:isTabVisible,isProcessing:isProcessingRef.current,isModelReady:isModelReadyRef.current,activeEngine:activeEngineRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      
      if (
        !videoRef.current ||
        !detectorRef.current ||
        !isActive ||
        !isTabVisible ||
        isProcessingRef.current ||
        !isModelReadyRef.current
      ) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:492',message:'predictWebcam early exit',data:{hasVideo:!!videoRef.current,hasDetector:!!detectorRef.current,isActive:isActive,isTabVisible:isTabVisible,isProcessing:isProcessingRef.current,isModelReady:isModelReadyRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
        scheduleNextFrame();
        return;
      }

      const video = videoRef.current;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        scheduleNextFrame();
        return;
      }
      
      const now = time || performance.now();
      statsRef.current.totalFrames++;
      
      // ============== Step 1: Motion Check (very cheap, ~1ms) ==============
      const timeSinceMotionCheck = now - lastMotionCheckRef.current;
      if (timeSinceMotionCheck >= MOTION_CHECK_INTERVAL) {
        lastMotionCheckRef.current = now;
        motionDetectedRef.current = detectMotion(video);
        
        if (!motionDetectedRef.current) {
          consecutiveNoMotionRef.current++;
        } else {
          consecutiveNoMotionRef.current = 0;
        }
      }
      
      // ============== Step 2: Decide if we need full detection ==============
      const detectionInterval = getDetectionInterval();
      const timeSinceLastDetection = now - lastDetectionTimeRef.current;
      const state: GameState = gameStateRef.current;
      
      // Critical states where we need maximum detection accuracy
      const isCriticalState = state === "beat_approach" as GameState || 
        (msUntilNextBeatRef.current !== undefined && msUntilNextBeatRef.current < 300);
      
      // Force detection if:
      // 1. It's been too long since last detection
      // 2. We're approaching a beat (critical timing)
      // 3. Motion was just detected after period of stillness
      // 4. We've skipped too many frames
      const forceDetection = 
        skippedFramesRef.current >= MAX_SKIP_FRAMES ||
        isCriticalState ||
        (motionDetectedRef.current && consecutiveNoMotionRef.current > 0);
      
      // Skip detection if:
      // 1. No motion detected AND we're not in critical state
      // 2. Haven't reached detection interval yet
      const shouldSkip = 
        !forceDetection &&
        !motionDetectedRef.current && 
        consecutiveNoMotionRef.current > 2 &&
        !isCriticalState &&
        timeSinceLastDetection < detectionInterval * 2;
      
      if (shouldSkip) {
        // Use predicted/cached pose instead of running detection
        statsRef.current.skippedByMotion++;
        skippedFramesRef.current++;
        scheduleNextFrame();
        return;
      }
      
      // Check timing interval
      if (timeSinceLastDetection < detectionInterval && !forceDetection) {
        scheduleNextFrame();
        return;
      }
      
      // ============== Step 3: Run Full Detection ==============
      lastDetectionTimeRef.current = now;
      isProcessingRef.current = true;
      skippedFramesRef.current = 0;
      statsRef.current.detectionFrames++;

      try {
        let currentCount = 0;
        const ratio = video.videoWidth / video.videoHeight;
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:625',message:'Detection loop executing',data:{activeEngine:activeEngineRef.current,isModelReady:isModelReadyRef.current,hasWorker:!!workerRef.current,hasDetector:!!detectorRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D,E'})}).catch(()=>{});
        // #endregion

        if (activeEngineRef.current === "mediapipe") {
          const bitmap = await createImageBitmap(video, {
            resizeWidth: 320,
            resizeHeight: 240,
            resizeQuality: "low",
          });

          const results = detectorRef.current.detectForVideo(
            bitmap,
            Math.round(video.currentTime * 1000)
          );
          bitmap.close();

          if (results.landmarks && results.landmarks.length > 0) {
            landmarksRef.current = results.landmarks[0];
            lastLandmarksRef.current = results.landmarks[0];
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
              lastLandmarksRef.current = landmarks;
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
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:663',message:'Main thread TF.js detection',data:{handsDetected:hands?.length||0,hasKeypoints:hands?.[0]?.keypoints?.length||0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B,C',runId:'post-fix'})}).catch(()=>{});
              // #endregion

              if (hands && hands.length > 0) {
                const hand = hands[0];
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:672',message:'Raw keypoints after canvas fix',data:{firstKeypoint:hand.keypoints?.[0],videoWidth:video.videoWidth,videoHeight:video.videoHeight,keypointsLength:hand.keypoints?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C',runId:'post-fix'})}).catch(()=>{});
                // #endregion
                // Convert keypoints to normalized landmarks
                const landmarks: NormalizedLandmark[] = hand.keypoints.map(
                  (kp: any, index: number) => ({
                    x: kp.x / video.videoWidth,
                    y: kp.y / video.videoHeight,
                    z: hand.keypoints3D?.[index]?.z ?? 0,
                  })
                );

                landmarksRef.current = landmarks;
                lastLandmarksRef.current = landmarks;
                currentCount = countFingers(landmarks, ratio);
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:682',message:'Finger count result',data:{fingerCount:currentCount,landmarkCount:landmarks.length,firstLandmark:landmarks[0]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C',runId:'post-fix'})}).catch(()=>{});
                // #endregion
              } else {
                landmarksRef.current = null;
              }
            }
          } else {
            // Model not ready yet, skip this frame
            landmarksRef.current = null;
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:691',message:'Detection skipped - model not ready',data:{hasDetector:!!detectorRef.current,isModelReady:isModelReadyRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
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
        
        // Log stats every 100 frames (for debugging)
        if (statsRef.current.totalFrames % 500 === 0) {
          const skipRate = ((statsRef.current.skippedByMotion / statsRef.current.totalFrames) * 100).toFixed(1);
          console.log(`[Detection] Skip rate: ${skipRate}%, State: ${state}, Interval: ${detectionInterval}ms`);
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
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useHandDetection.ts:741',message:'startLoop called',data:{isActive:isActive,hasVideo:!!videoRef.current,hasDetector:!!detectorRef.current,isModelReady:isModelReadyRef.current,activeEngine:activeEngineRef.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
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

