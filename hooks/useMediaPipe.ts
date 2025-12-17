/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver, HandLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';

export const useMediaPipe = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [fingerCount, setFingerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null);

  // Helper: Count extended fingers with robust geometric heuristics
  const countFingers = (landmarks: NormalizedLandmark[]): number => {
      if (!landmarks || landmarks.length < 21) return 0;
      
      const wrist = landmarks[0];
      const indexMCP = landmarks[5];
      
      // Scale reference: Distance from Wrist to Index MCP (Palm size approx)
      const scale = Math.hypot(indexMCP.x - wrist.x, indexMCP.y - wrist.y);
      
      let count = 0;
      
      // --- THUMB (Points 1, 2, 3, 4) ---
      const thumbMCP = landmarks[2];
      const thumbIP = landmarks[3];
      const thumbTip = landmarks[4];
      
      // 1. Linearity Check: Is the thumb straight? 
      // Compare direct distance (MCP->Tip) vs sum of segments (MCP->IP + IP->Tip)
      const distMCP_IP = Math.hypot(thumbIP.x - thumbMCP.x, thumbIP.y - thumbMCP.y);
      const distIP_Tip = Math.hypot(thumbTip.x - thumbIP.x, thumbTip.y - thumbIP.y);
      const distMCP_Tip = Math.hypot(thumbTip.x - thumbMCP.x, thumbTip.y - thumbMCP.y);
      
      const linearity = distMCP_Tip / (distMCP_IP + distIP_Tip);

      // 2. Abduction Check: Is the thumb away from the Index finger?
      // Distance from Thumb Tip to Index MCP. In a fist/tucked pose, this is small.
      const distTip_IndexMCP = Math.hypot(thumbTip.x - indexMCP.x, thumbTip.y - indexMCP.y);
      
      // Heuristic: Thumb is extended if it's mostly straight AND far enough from the index knuckle
      // 0.9 linearity allows for slight curve. 0.5 * scale ensures it's not tucked against palm.
      if (linearity > 0.85 && distTip_IndexMCP > scale * 0.5) {
          count++;
      }

      // --- FINGERS (Index, Middle, Ring, Pinky) ---
      // Robust rotation-invariant check:
      // An extended finger's Tip is significantly further from the Wrist than its PIP (knuckle).
      // A curled finger's Tip is closer to the Wrist than its PIP (or roughly same).
      
      const fingers = [
          { name: 'index', tip: 8, pip: 6 },
          { name: 'middle', tip: 12, pip: 10 },
          { name: 'ring', tip: 16, pip: 14 },
          { name: 'pinky', tip: 20, pip: 18 }
      ];

      for (const f of fingers) {
          const tip = landmarks[f.tip];
          const pip = landmarks[f.pip];
          
          const distWristTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
          const distWristPIP = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
          
          // Check: Tip distance > PIP distance + buffer (to prevent flicker)
          if (distWristTip > distWristPIP + (scale * 0.15)) {
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
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
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
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
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
             try {
                 const results = landmarkerRef.current.detectForVideo(video, startTimeMs);
                 
                 if (results.landmarks && results.landmarks.length > 0) {
                     const lm = results.landmarks[0];
                     landmarksRef.current = lm;
                     const count = countFingers(lm);
                     // Only update state if number changes to avoid re-renders
                     setFingerCount(prev => prev === count ? prev : count);
                 } else {
                     landmarksRef.current = null;
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
          stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [videoRef]);

  return { isCameraReady, fingerCount, error, landmarksRef };
};