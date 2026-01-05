import { useRef, useState, useCallback, useEffect } from "react";

interface RecorderState {
  isRecording: boolean;
  videoBlob: Blob | null;
}

export interface FailOverlayInfo {
  show: boolean;
  round: number;
}

const IS_MOBILE =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export const useVideoRecorder = (
  videoRef: React.RefObject<HTMLVideoElement>,
  audioStream?: MediaStream | null,
  currentRound?: number,
  currentBpm?: number
) => {
  const [recorderState, setRecorderState] = useState<RecorderState>({
    isRecording: false,
    videoBlob: null,
  });
  const [isCameraReady, setIsCameraReady] = useState(false);

  // Worker and canvas refs
  const workerRef = useRef<Worker | null>(null);
  const isWorkerReadyRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);
  const frameIdRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  // Session tracking to prevent stale onstop callbacks
  const sessionIdRef = useRef(0);

  // Overlay state refs
  const overlayTextRef = useRef<string>("");
  const lastOverlayTextRef = useRef<string>("");
  const failInfoRef = useRef<FailOverlayInfo>({ show: false, round: 1 });
  const currentRoundRef = useRef<number>(currentRound || 1);
  const currentBpmRef = useRef<number>(currentBpm || 95);

  // Target FPS for frame sending
  const TARGET_FPS = IS_MOBILE ? 30 : 60;
  const FRAME_INTERVAL = 1000 / TARGET_FPS;

  // Update refs when props change
  useEffect(() => {
    if (currentRound !== undefined) currentRoundRef.current = currentRound;
  }, [currentRound]);

  useEffect(() => {
    if (currentBpm !== undefined) currentBpmRef.current = currentBpm;
  }, [currentBpm]);

  // ============== HIGH-RES PREVIEW & RECORDING CAMERA SETUP ==============
  useEffect(() => {
    let isActive = true;

    const startHighResCamera = async () => {
      try {
        console.log("[VideoRecorder] Initializing Camera (640x480)...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: IS_MOBILE ? 30 : 60 },
          },
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            if (isActive && videoRef.current) {
              const { videoWidth, videoHeight } = videoRef.current;
              console.log(
                `[VideoRecorder] Stream ready: ${videoWidth}x${videoHeight}`
              );
              setIsCameraReady(true);
            }
          };
          await videoRef.current.play();
        }
      } catch (err) {
        console.error("High-Res Camera Error:", err);
      }
    };

    startHighResCamera();

    return () => {
      isActive = false;
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [videoRef]);

  useEffect(() => {
    // Create canvas for MediaRecorder (main thread canvas)
    const canvas = document.createElement("canvas");
    // Use 4:3 globally for consistency as requested
    canvas.width = 640;
    canvas.height = 480;

    canvasRef.current = canvas;
    ctxRef.current = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    // Initialize worker
    const worker = new Worker(
      new URL("./videoRecorder.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === "ready") {
        console.log("VideoRecorder Worker: Ready");
        isWorkerReadyRef.current = true;
      } else if (type === "frameReady") {
        // Draw the rendered frame from worker to main canvas
        const ctx = ctxRef.current;
        if (ctx && payload.bitmap) {
          ctx.drawImage(payload.bitmap, 0, 0);
          payload.bitmap.close(); // Free memory
        }
      }
    };

    worker.onerror = (err) => {
      console.error("VideoRecorder Worker error:", err);
    };

    // Initialize worker with canvas dimensions
    worker.postMessage({
      type: "init",
      payload: {
        width: canvas.width,
        height: canvas.height,
        isMobile: IS_MOBILE,
      },
    });

    workerRef.current = worker;

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (workerRef.current) {
        workerRef.current.postMessage({ type: "terminate" });
        workerRef.current.terminate();
      }
    };
  }, []);

  const setOverlayText = useCallback((text: string) => {
    if (text === lastOverlayTextRef.current) return;
    overlayTextRef.current = text;
    lastOverlayTextRef.current = text;

    // Send to worker
    if (workerRef.current && isWorkerReadyRef.current) {
      workerRef.current.postMessage({
        type: "updateOverlay",
        payload: { lines: text.split("\\n") },
      });
    }
  }, []);

  const setFailOverlay = useCallback((info: FailOverlayInfo) => {
    failInfoRef.current = info;

    // Send to worker
    if (workerRef.current && isWorkerReadyRef.current) {
      workerRef.current.postMessage({
        type: "updateFailInfo",
        payload: info,
      });
    }
  }, []);

  // Clear video blob immediately (for replay/restart scenarios)
  const clearVideo = useCallback(() => {
    sessionIdRef.current += 1; // Invalidate any pending onstop callbacks
    setRecorderState({ isRecording: false, videoBlob: null }); // Also reset isRecording
    chunksRef.current = [];
  }, []);

  const startRecording = useCallback(() => {
    // Clear any pending stop timeout
    if (stopTimeoutRef.current !== null) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    // If already recording, don't start a new session
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      console.log("Already recording, skipping start.");
      return;
    }

    console.log("Attempting to start recording...");
    if (
      !videoRef.current ||
      !canvasRef.current ||
      !workerRef.current ||
      !isWorkerReadyRef.current
    ) {
      console.error("Recording failed: Refs missing", {
        video: !!videoRef.current,
        canvas: !!canvasRef.current,
        worker: !!workerRef.current,
        workerReady: isWorkerReadyRef.current,
      });
      return;
    }

    // Increment session ID to invalidate old onstop callbacks
    sessionIdRef.current += 1;
    const currentSession = sessionIdRef.current;

    // Reset old data
    chunksRef.current = [];
    setRecorderState((prev) => ({
      ...prev,
      videoBlob: null,
      isRecording: true,
    }));
    failInfoRef.current = { show: false, round: 1 };
    frameIdRef.current = 0;
    lastFrameTimeRef.current = 0;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const worker = workerRef.current;

    // Frame sending loop - captures video frames and sends to worker
    const sendFrame = async (timestamp: number) => {
      if (!video || video.readyState !== 4) {
        rafIdRef.current = requestAnimationFrame(sendFrame);
        return;
      }

      // Throttle frame rate
      if (timestamp - lastFrameTimeRef.current < FRAME_INTERVAL) {
        rafIdRef.current = requestAnimationFrame(sendFrame);
        return;
      }
      lastFrameTimeRef.current = timestamp;

      try {
        // Create ImageBitmap from video (zero-copy on supported browsers)
        const videoBitmap = await createImageBitmap(video);

        // Send to worker for rendering
        worker.postMessage(
          {
            type: "drawFrame",
            payload: {
              videoBitmap,
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              frameId: frameIdRef.current++,
            },
          },
          [videoBitmap] // Transfer the bitmap
        );
      } catch (e) {
        // Silently skip frame on error (video not ready, etc.)
      }

      rafIdRef.current = requestAnimationFrame(sendFrame);
    };

    // Start frame loop
    rafIdRef.current = requestAnimationFrame(sendFrame);

    // Start MediaRecorder from Canvas Stream
    const stream = canvas.captureStream(TARGET_FPS);

    // Add Audio if available
    if (audioStream) {
      audioStream.getAudioTracks().forEach((track) => {
        stream.addTrack(track);
      });
    }

    // Order of preference for video codec
    const types = [
      'video/mp4;codecs="avc1,mp4a.40.2"',
      "video/mp4;codecs=avc1",
      "video/mp4",
      "video/webm;codecs=h264,opus",
      "video/webm;codecs=h264",
      "video/webm",
    ];

    const mimeType =
      types.find((type) => MediaRecorder.isTypeSupported(type)) || "video/mp4";

    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        // Increase bitrate for higher FPS (30fps on mobile -> 3Mbps, 60fps on desktop -> 8Mbps)
        videoBitsPerSecond: IS_MOBILE ? 3000000 : 8000000,
      });

      recorder.ondataavailable = (e) => {
        // ONLY collect chunks if session is still valid
        if (sessionIdRef.current === currentSession && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        // CRITICAL: Only set blob if this session is still active
        if (sessionIdRef.current === currentSession) {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          setRecorderState({ isRecording: false, videoBlob: blob });
        } else {
          // Session was invalidated - check if a new recording has started
          // Only set isRecording: false if no new recording is active
          setRecorderState((prev) => {
            // If there's a new MediaRecorder that's recording, don't change state
            const hasNewRecorder =
              mediaRecorderRef.current &&
              mediaRecorderRef.current.state === "recording";
            if (hasNewRecorder) {
              return prev; // Keep current state (isRecording should be true)
            }
            // Otherwise, it's safe to mark as stopped
            return { ...prev, isRecording: false };
          });
        }
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
    } catch (e) {
      console.error("Recording failed to start", e);
    }
  }, [videoRef, audioStream, TARGET_FPS, FRAME_INTERVAL]);

  const stopRecording = useCallback(() => {
    // Clear any pending stop timeout
    if (stopTimeoutRef.current !== null) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    return new Promise<void>((resolve) => {
      // Stop the frame loop
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        const recorder = mediaRecorderRef.current;
        const handleStop = () => {
          recorder.removeEventListener("stop", handleStop);
          // Clear the reference AFTER stopping to prevent stale callbacks
          if (mediaRecorderRef.current === recorder) {
            mediaRecorderRef.current = null;
          }
          resolve();
        };
        recorder.addEventListener("stop", handleStop);
        recorder.stop();
      } else {
        // Clear reference even if already inactive
        mediaRecorderRef.current = null;
        resolve();
      }
    });
  }, []);

  // Check actual MediaRecorder state (not React state which may be stale)
  const isActuallyRecording = useCallback(() => {
    return mediaRecorderRef.current?.state === "recording";
  }, []);

  return {
    isRecording: recorderState.isRecording,
    videoBlob: recorderState.videoBlob,
    isCameraReady,
    startRecording,
    stopRecording,
    setOverlayText,
    setFailOverlay,
    clearVideo,
    isActuallyRecording,
  };
};
