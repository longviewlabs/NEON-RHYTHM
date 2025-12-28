import {
  HandLandmarker,
  FilesetResolver,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

let handLandmarker: HandLandmarker | null = null;

async function initHandLandmarker() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
    );

    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5, // Lowered for mobile/downscaled detection
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    self.postMessage({ type: "ready" });
  } catch (err: any) {
    self.postMessage({
      type: "error",
      payload: err.message || "Unknown worker error",
    });
  }
}

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === "init") {
    await initHandLandmarker();
  } else if (type === "detect") {
    if (!handLandmarker) return;

    const { imageBitmap, timestamp } = payload;
    // console.log("Worker starting detection at", timestamp);

    try {
      // detectForVideo accepts ImageBitmap
      const results = handLandmarker.detectForVideo(imageBitmap, timestamp);

      if (results.landmarks && results.landmarks.length > 0) {
        // console.log("Landmarks found in worker");
        self.postMessage({
          type: "results",
          payload: {
            results,
            timestamp,
          },
        });
      } else {
        self.postMessage({
          type: "results",
          payload: {
            results: { landmarks: [], worldLandmarks: [], handednesses: [] },
            timestamp,
          },
        });
      }

      // Close the bitmap to free memory
      imageBitmap.close();
    } catch (error) {
      console.error("Worker detection error:", error);
    }
  }
};
