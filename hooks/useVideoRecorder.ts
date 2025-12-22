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

        // Start Draw Loop
        const draw = () => {
            if (ctx && video.readyState === 4) {
                // Draw Video
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Draw Overlay (if any)
                if (overlayTextRef.current) {
                    ctx.save();
                    ctx.shadowColor = "black";
                    ctx.shadowBlur = 4;
                    ctx.lineWidth = 4;
                    ctx.strokeStyle = "rgba(0,0,0,0.5)";
                    ctx.fillStyle = "white";
                    ctx.font = "900 30px Inter, sans-serif";
                    ctx.textAlign = "center";

                    // Draw multiple lines if needed
                    const lines = overlayTextRef.current.split("\\n");
                    lines.forEach((line, i) => {
                        ctx.strokeText(line, canvas.width / 2, canvas.height - 50 - (lines.length - 1 - i) * 40);
                        ctx.fillText(line, canvas.width / 2, canvas.height - 50 - (lines.length - 1 - i) * 40);
                    });

                    ctx.restore();
                }
            }
            rafIdRef.current = requestAnimationFrame(draw);
        };
        draw();

        // Start MediaRecorder from Canvas Stream
        const stream = canvas.captureStream(30); // 30 FPS

        // Attempt MP4, fall back to WebM
        const mimeType = MediaRecorder.isTypeSupported("video/web;codecs=h264")
            ? "video/mp4"
            : "video/webm";

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

            recorder.start();
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
