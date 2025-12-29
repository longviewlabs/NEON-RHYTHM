// Hand Detection Worker - Offloads TensorFlow.js detection from main thread
// Uses OffscreenCanvas for GPU-accelerated detection

// #region agent log
fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:5',message:'Worker script start',data:{hasGlobalThis:typeof globalThis!=='undefined',hasSelf:typeof self!=='undefined',hasAtobBefore:typeof atob!=='undefined',hasGlobalThisAtobBefore:typeof globalThis.atob!=='undefined',hasSelfAtobBefore:typeof (self as any).atob!=='undefined'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,D,E'})}).catch(()=>{});
// #endregion

// Define atob/btoa globally BEFORE any imports or type declarations
// TensorFlow.js checks for these during module initialization
globalThis.atob = (base64: string): string => {
  const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  const cleanBase64 = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  
  for (let i = 0; i < cleanBase64.length; i += 4) {
    const enc1 = base64Chars.indexOf(cleanBase64[i]);
    const enc2 = base64Chars.indexOf(cleanBase64[i + 1]);
    const enc3 = base64Chars.indexOf(cleanBase64[i + 2]);
    const enc4 = base64Chars.indexOf(cleanBase64[i + 3]);
    
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    
    result += String.fromCharCode(chr1);
    
    if (enc3 !== 64 && enc3 !== -1) {
      result += String.fromCharCode(chr2);
    }
    if (enc4 !== 64 && enc4 !== -1) {
      result += String.fromCharCode(chr3);
    }
  }
  
  return result;
};

globalThis.btoa = (str: string): string => {
  const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  
  for (let i = 0; i < str.length; i += 3) {
    const byte1 = str.charCodeAt(i);
    const byte2 = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
    const byte3 = i + 2 < str.length ? str.charCodeAt(i + 2) : 0;
    
    const enc1 = byte1 >> 2;
    const enc2 = ((byte1 & 3) << 4) | (byte2 >> 4);
    const enc3 = ((byte2 & 15) << 2) | (byte3 >> 6);
    const enc4 = byte3 & 63;
    
    result += base64Chars[enc1] + base64Chars[enc2];
    result += i + 1 < str.length ? base64Chars[enc3] : "=";
    result += i + 2 < str.length ? base64Chars[enc4] : "=";
  }
  
  return result;
};

// Also bind to self explicitly (Hypothesis D)
(self as any).atob = globalThis.atob;
(self as any).btoa = globalThis.btoa;

// Test the polyfill with a simple base64 string (Hypothesis B)
let atobTestResult = '';
let atobTestError = '';
try {
  const testInput = 'SGVsbG8gV29ybGQ='; // "Hello World" in base64
  atobTestResult = globalThis.atob(testInput);
} catch (e: any) {
  atobTestError = e.message;
}

// #region agent log
fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:72',message:'Polyfills defined and tested',data:{hasAtobAfter:typeof atob!=='undefined',hasGlobalThisAtob:typeof globalThis.atob!=='undefined',hasSelfAtob:typeof (self as any).atob!=='undefined',atobType:typeof atob,globalThisAtobType:typeof globalThis.atob,selfAtobType:typeof (self as any).atob,atobSameAsGlobal:typeof atob!=='undefined'&&atob===globalThis.atob,selfAtobSameAsGlobal:(self as any).atob===globalThis.atob,atobTestResult:atobTestResult,atobTestError:atobTestError,atobWorks:!!atobTestResult&&!atobTestError},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,B,D,E'})}).catch(()=>{});
// #endregion

declare const self: Worker & typeof globalThis;

interface DetectionResult {
  landmarks: Array<{ x: number; y: number; z: number }> | null;
  frameId: number;
}

let detector: any = null;
let isModelReady = false;
let isModelLoading = false;
const IS_MOBILE = typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Initialize TensorFlow.js and detector
async function initDetector() {
  if (isModelLoading) return;
  
  try {
    isModelLoading = true;
    console.log("[Worker] Loading TensorFlow.js model...");

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:93',message:'Before TF.js imports',data:{hasAtob:typeof atob!=='undefined',hasGlobalThisAtob:typeof globalThis.atob!=='undefined',hasSelfAtob:typeof (self as any).atob!=='undefined',atobIsFunction:typeof atob==='function',canCallAtob:typeof atob==='function'&&typeof globalThis.atob==='function'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,C,E'})}).catch(()=>{});
    // #endregion

    // Dynamic imports for TensorFlow.js
    const tf = await import("@tensorflow/tfjs");
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:102',message:'After tfjs import',data:{hasAtobAfterTfjs:typeof atob!=='undefined',hasGlobalThisAtobAfterTfjs:typeof globalThis.atob!=='undefined',hasSelfAtobAfterTfjs:typeof (self as any).atob!=='undefined',tfLoaded:!!tf},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,C,E'})}).catch(()=>{});
    // #endregion
    
    const handPoseDetection = await import(
      /* @vite-ignore */ "@tensorflow-models/hand-pose-detection"
    );

    // Initialize TensorFlow.js backend in worker
    await tf.setBackend("webgl");
    await tf.ready();
    console.log("[Worker] TensorFlow.js backend ready:", tf.getBackend());

    // Check what TensorFlow.js env().global contains
    const tfEnv = tf.env();
    const tfGlobal = tfEnv.global as any;
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:120',message:'Before createDetector - TF env check',data:{hasAtob:typeof atob!=='undefined',hasGlobalThisAtob:typeof globalThis.atob!=='undefined',hasSelfAtob:typeof (self as any).atob!=='undefined',hasTfEnvGlobalAtob:typeof tfGlobal?.atob!=='undefined',tfGlobalIsGlobalThis:tfGlobal===globalThis,tfGlobalIsSelf:tfGlobal===self,tfGlobalType:typeof tfGlobal,backend:tf.getBackend()},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    
    // FIX: Set atob on TensorFlow's global object directly
    if (tfGlobal && typeof tfGlobal.atob === 'undefined') {
      tfGlobal.atob = globalThis.atob;
      tfGlobal.btoa = globalThis.btoa;
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:132',message:'After setting atob on TF global',data:{hasTfGlobalAtobNow:typeof tfGlobal?.atob!=='undefined',tfGlobalAtobType:typeof tfGlobal?.atob},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
    // #endregion

    // Use TensorFlow.js runtime (not MediaPipe) - required for module workers
    const model = handPoseDetection.SupportedModels.MediaPipeHands;
    detector = await handPoseDetection.createDetector(model, {
      runtime: "tfjs", // ✅ Changed from "mediapipe" to "tfjs"
      modelType: IS_MOBILE ? "lite" : "full",
      maxHands: 1,
    });

    isModelReady = true;
    isModelLoading = false;
    console.log("[Worker] TensorFlow.js detector ready");
    self.postMessage({ type: "ready" });
  } catch (err: any) {
    isModelLoading = false;
    console.error("[Worker] Error initializing detector:", err);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:134',message:'Worker init error',data:{errorMsg:err.message,errorStack:err.stack,hasAtobOnError:typeof atob!=='undefined',hasGlobalThisAtobOnError:typeof globalThis.atob!=='undefined',hasSelfAtobOnError:typeof (self as any).atob!=='undefined',atobTypeOnError:typeof atob},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,B,C,D,E'})}).catch(()=>{});
    // #endregion
    self.postMessage({ 
      type: "error", 
      payload: { message: err.message || "Failed to load detector" } 
    });
  }
}

// Process video frame and detect hands
async function detectHands(
  videoBitmap: ImageBitmap,
  videoWidth: number,
  videoHeight: number
): Promise<Array<{ x: number; y: number; z: number }> | null> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:169',message:'detectHands entry',data:{hasDetector:!!detector,isModelReady:isModelReady,videoWidth:videoWidth,videoHeight:videoHeight},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
  // #endregion
  
  if (!detector || !isModelReady) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:176',message:'detectHands early return',data:{hasDetector:!!detector,isModelReady:isModelReady},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    return null;
  }

  try {
    // Create OffscreenCanvas from ImageBitmap for detection
    const canvas = new OffscreenCanvas(videoWidth, videoHeight);
    const ctx = canvas.getContext("2d");
    
    if (!ctx) {
      console.error("[Worker] Failed to get 2d context");
      return null;
    }

    // Draw video frame to canvas
    ctx.drawImage(videoBitmap, 0, 0, videoWidth, videoHeight);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:197',message:'Before estimateHands',data:{hasCanvas:!!canvas,hasDetector:!!detector},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    
    // Detect hands using TensorFlow.js
    const hands = await detector.estimateHands(canvas as any, {
      flipHorizontal: false,
    });
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:209',message:'After estimateHands',data:{handsDetected:hands?.length||0,hasHands:!!(hands&&hands.length>0),handsType:typeof hands,isArray:Array.isArray(hands)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
    // #endregion

    // Convert to normalized landmarks format (same as MediaPipe)
    if (hands && hands.length > 0) {
      const hand = hands[0];
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:218',message:'Processing hand landmarks',data:{hasKeypoints:!!hand.keypoints,keypointsLength:hand.keypoints?.length||0,hasKeypoints3D:!!hand.keypoints3D},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
      // #endregion
      
      const landmarks = hand.keypoints.map((kp: any, index: number) => ({
        x: kp.x / videoWidth,
        y: kp.y / videoHeight,
        z: hand.keypoints3D?.[index]?.z ?? 0,
      }));

      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:228',message:'Returning landmarks',data:{landmarksCount:landmarks.length,firstLandmark:landmarks[0]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
      // #endregion

      return landmarks;
    }

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:235',message:'No hands detected',data:{handsLength:hands?.length||0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
    // #endregion

    return null;
  } catch (err: any) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:243',message:'Detection error caught',data:{errorMsg:err.message,errorStack:err.stack},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    console.error("[Worker] Detection error:", err);
    return null;
  }
}

// Message handler
self.addEventListener("message", async (event) => {
  const { type, payload } = event.data;
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:216',message:'Worker received message',data:{messageType:type,isModelReady:isModelReady,hasPayload:!!payload,hasVideoBitmap:!!payload?.videoBitmap},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
  // #endregion

  try {
    switch (type) {
      case "init":
        await initDetector();
        break;

      case "detect":
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:229',message:'Worker detect message',data:{isModelReady:isModelReady,hasDetector:!!detector,payloadKeys:payload?Object.keys(payload):[]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        
        if (!isModelReady) {
          // Wait for model to be ready
          const checkReady = setInterval(() => {
            if (isModelReady) {
              clearInterval(checkReady);
              handleDetection(payload);
            }
          }, 50);
          return;
        }
        await handleDetection(payload);
        break;

      case "terminate":
        if (detector) {
          detector.dispose?.();
          detector = null;
        }
        isModelReady = false;
        break;
    }
  } catch (err: any) {
    console.error("[Worker] Error handling message:", err);
    self.postMessage({
      type: "error",
      payload: { message: err.message || "Unknown error" },
    });
  }
});

// Handle detection request
async function handleDetection(payload: any) {
  const { videoBitmap, videoWidth, videoHeight, frameId } = payload;
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:268',message:'handleDetection called',data:{hasVideoBitmap:!!videoBitmap,videoWidth:videoWidth,videoHeight:videoHeight,frameId:frameId,videoBitmapType:typeof videoBitmap},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
  // #endregion

  if (!videoBitmap) {
    console.warn("[Worker] No video bitmap provided");
    return;
  }

  const landmarks = await detectHands(videoBitmap, videoWidth, videoHeight);

  // Close bitmap to free memory immediately
  videoBitmap.close();

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/009f2daa-00f2-4661-b284-18865ef5561f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handDetection.worker.ts:292',message:'Sending result back to main',data:{hasLandmarks:!!landmarks,landmarksLength:landmarks?.length||0,frameId:frameId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
  // #endregion

  // Send result back to main thread
  self.postMessage({
    type: "detection",
    payload: { landmarks, frameId },
  });
}

console.log("[Worker] Hand Detection Worker loaded");

