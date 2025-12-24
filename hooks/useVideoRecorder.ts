import { useRef, useState, useCallback, useEffect } from "react";

interface RecorderState {
    isRecording: boolean;
    videoBlob: Blob | null;
}

export const useVideoRecorder = (videoRef: React.RefObject<HTMLVideoElement>) => {
    const [recorderState, setRecorderState] = useState<RecorderState>({
        isRecording: false,
        videoBlob: null,
    });

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const overlayTextRef = useRef<string>("");

    // Initialize canvas on mount
    useEffect(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 640; // Standard resolution
        canvas.height = 480;
        canvasRef.current = canvas;
        return () => {
            if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        };
    }, []);

    const setOverlayText = useCallback((text: string) => {
        overlayTextRef.current = text;
    }, []);

    const startRecording = useCallback(() => {
        // If already recording, don't start a new session (prevents reset of chunksRef)
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            console.log("Already recording, skipping start.");
            return;
        }

        console.log("Attempting to start recording...");
        if (!videoRef.current || !canvasRef.current) {
            console.error("Recording failed: Refs missing", { video: !!videoRef.current, canvas: !!canvasRef.current });
            return;
        }

        // Reset old data
        chunksRef.current = [];
        setRecorderState((prev) => ({ ...prev, videoBlob: null, isRecording: true }));

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const video = videoRef.current;

        // Set canvas dimensions to match video source (Mobile fix)
        if (video.videoWidth && video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }

        // Start Draw Loop
        const draw = () => {
            if (ctx && video.readyState === 4) {
                // Draw Video (Maintain aspect ratio by using natural dimensions)
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Draw Overlay (if any)
                if (overlayTextRef.current) {
                    ctx.save();
                    ctx.shadowColor = "black";
                    ctx.shadowBlur = 4;
                    ctx.lineWidth = 4;
                    ctx.strokeStyle = "rgba(0,0,0,0.5)";
                    ctx.fillStyle = "white";
                    
                    // Dynamic font size based on height
                    const fontSize = Math.max(20, Math.floor(canvas.height * 0.05));
                    ctx.font = `900 ${fontSize}px Inter, sans-serif`;
                    ctx.textAlign = "center";

                    // Draw multiple lines if needed
                    const lines = overlayTextRef.current.split("\\n");
                    const lineHeight = fontSize * 1.3;
                    lines.forEach((line, i) => {
                        const y = canvas.height - (canvas.height * 0.1) - (lines.length - 1 - i) * lineHeight;
                        const x = canvas.width / 2;

                        if (line.includes("[[") && line.includes("]]")) {
                            // Support [[yellow]] highlighting
                            const segments = line.split(/(\[\[.*?\]\])/g);
                            const cleanLine = line.replace(/\[\[|\]\]/g, "");
                            const totalWidth = ctx.measureText(cleanLine).width;
                            let currentX = x - totalWidth / 2;

                            segments.forEach((segment) => {
                                if (!segment) return;
                                if (segment.startsWith("[[") && segment.endsWith("]]")) {
                                    const text = segment.slice(2, -2);
                                    ctx.fillStyle = "#FACC15"; // Yellow (Tailwind yellow-400)
                                    ctx.strokeText(text, currentX + ctx.measureText(text).width / 2, y);
                                    ctx.fillText(text, currentX + ctx.measureText(text).width / 2, y);
                                    currentX += ctx.measureText(text).width;
                                } else {
                                    ctx.fillStyle = "white";
                                    ctx.strokeText(segment, currentX + ctx.measureText(segment).width / 2, y);
                                    ctx.fillText(segment, currentX + ctx.measureText(segment).width / 2, y);
                                    currentX += ctx.measureText(segment).width;
                                }
                            });
                        } else {
                            ctx.fillStyle = "white";
                            ctx.strokeText(line, x, y);
                            ctx.fillText(line, x, y);
                        }
                    });

                    ctx.restore();
                }
            }
            rafIdRef.current = requestAnimationFrame(draw);
        };
        draw();

        // Start MediaRecorder from Canvas Stream
        const stream = canvas.captureStream(30); // 30 FPS

        // Order of preference: MP4 (iOS/Safari), then WebM with H264 (Chrome), then standard WebM
        const types = [
            "video/mp4;codecs=avc1",
            "video/mp4",
            "video/webm;codecs=h264",
            "video/webm",
        ];

        const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type)) || "video/mp4";

        try {
            const recorder = new MediaRecorder(stream, { mimeType });

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                setRecorderState({ isRecording: false, videoBlob: blob });
                if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
            };

            recorder.start(1000); // Collect data every second to ensure ondataavailable fires
            mediaRecorderRef.current = recorder;
        } catch (e) {
            console.error("Recording failed to start", e);
        }
    }, [videoRef]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
    }, []);

    return {
        isRecording: recorderState.isRecording,
        videoBlob: recorderState.videoBlob,
        startRecording,
        stopRecording,
        setOverlayText,
    };
};
