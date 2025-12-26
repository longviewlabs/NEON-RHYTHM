import { useRef, useState, useCallback, useEffect } from "react";

interface RecorderState {
    isRecording: boolean;
    videoBlob: Blob | null;
}

export interface FailOverlayInfo {
    show: boolean;
    round: number;
}

export const useVideoRecorder = (videoRef: React.RefObject<HTMLVideoElement>, audioStream?: MediaStream | null) => {
    const [recorderState, setRecorderState] = useState<RecorderState>({
        isRecording: false,
        videoBlob: null,
    });

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const overlayTextRef = useRef<string>("");
    const lastOverlayTextRef = useRef<string>("");
    const preSplitLinesRef = useRef<string[]>([]);
    const failInfoRef = useRef<FailOverlayInfo>({ show: false, round: 1 });

    // Initialize canvas on mount
    useEffect(() => {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const canvas = document.createElement("canvas");
        // Goal: 1080x1920 (9:16 Vertical) - Scaled down for mobile performance
        // Reducing mobile resolution even further for performance (360x640 is often enough for social)
        canvas.width = isMobile ? 360 : 720;
        canvas.height = isMobile ? 640 : 1280;
        canvasRef.current = canvas;
        return () => {
            if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        };
    }, []);

    const setOverlayText = useCallback((text: string) => {
        if (text === lastOverlayTextRef.current) return;
        overlayTextRef.current = text;
        lastOverlayTextRef.current = text;
        preSplitLinesRef.current = text.split("\\n");
    }, []);

    const setFailOverlay = useCallback((info: FailOverlayInfo) => {
        failInfoRef.current = info;
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
        failInfoRef.current = { show: false, round: 1 };

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { 
            alpha: false,
            desynchronized: true // Performance hint for low-latency drawing
        }); 
        const video = videoRef.current;
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // Start Draw Loop
        const draw = () => {
            if (!ctx || video.readyState !== 4) {
                rafIdRef.current = requestAnimationFrame(draw);
                return;
            }

            // 1. Determine crop for 9:16
            const videoW = video.videoWidth;
            const videoH = video.videoHeight;
            const targetAspect = 9 / 16;
            const videoAspect = videoW / videoH;

            let sourceW, sourceH, offsetX, offsetY;

            if (videoAspect > targetAspect) {
                sourceH = videoH;
                sourceW = videoH * targetAspect;
                offsetX = (videoW - sourceW) / 2;
                offsetY = 0;
            } else {
                sourceW = videoW;
                sourceH = videoW / targetAspect;
                offsetX = 0;
                offsetY = (videoH - sourceH) / 2;
            }

            // 2. Draw Mirrored Video
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(
                video,
                offsetX, offsetY, sourceW, sourceH,
                -canvas.width, 0, canvas.width, canvas.height
            );
            ctx.restore();

            // 3. Draw Watermark (Skip shadow on mobile)
            ctx.save();
            if (!isMobile) {
                ctx.shadowColor = "rgba(0,0,0,0.5)";
                ctx.shadowBlur = 10;
            }
            ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
            ctx.font = "900 30px Inter, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText("NEON-RHYTHM", canvas.width - 40, canvas.height - 40);
            ctx.restore();

            // 4. Draw Fail Overlays
            const failInfo = failInfoRef.current;
            if (failInfo.show) {
                ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height * 0.35);
                ctx.rotate(-0.1);
                if (!isMobile) {
                    ctx.shadowColor = "rgba(220, 38, 38, 0.8)";
                    ctx.shadowBlur = 40;
                }
                ctx.fillStyle = "#dc2626";
                ctx.font = "black 150px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("FAIL", 0, 0);
                ctx.restore();

                const barY = canvas.height * 0.55;
                const barH = 100;
                ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
                ctx.fillRect(0, barY - barH / 2, canvas.width, barH);
                
                ctx.fillStyle = "white";
                ctx.font = "900 30px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(`GAME OVER | ROUND ${failInfo.round}`, canvas.width / 2, barY);
            }

            // 5. Draw Game Overlay Text (Pre-split)
            const lines = preSplitLinesRef.current;
            if (lines.length > 0 && !failInfo.show) {
                ctx.save();
                if (!isMobile) {
                    ctx.shadowColor = "black";
                    ctx.shadowBlur = 8;
                }
                ctx.lineWidth = 6;
                ctx.strokeStyle = "rgba(0,0,0,0.7)";
                ctx.fillStyle = "white";

                const fontSize = isMobile ? 40 : 50;
                ctx.font = `900 ${fontSize}px Inter, sans-serif`;
                ctx.textAlign = "center";

                const lineHeight = fontSize * 1.4;
                lines.forEach((line, i) => {
                    const y = canvas.height - 200 - (lines.length - 1 - i) * lineHeight;
                    const x = canvas.width / 2;

                    if (line.includes("[[") && line.includes("]]")) {
                        const segments = line.split(/(\[\[.*?\]\])/g);
                        const cleanLine = line.replace(/\[\[|\]\]/g, "");
                        const totalWidth = ctx.measureText(cleanLine).width;
                        let currentX = x - totalWidth / 2;

                        segments.forEach((segment) => {
                            if (!segment) return;
                            if (segment.startsWith("[[") && segment.endsWith("]]")) {
                                const text = segment.slice(2, -2);
                                ctx.fillStyle = "#FACC15";
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
            rafIdRef.current = requestAnimationFrame(draw);
        };
        draw();

        // Start MediaRecorder from Canvas Stream
        const stream = canvas.captureStream(isMobile ? 20 : 24); // Lower FPS for recording

        // Add Audio if available
        if (audioStream) {
            audioStream.getAudioTracks().forEach(track => {
                stream.addTrack(track);
            });
        }

        // Order of preference
        const types = [
            'video/mp4;codecs="avc1,mp4a.40.2"',
            "video/mp4;codecs=avc1",
            "video/mp4",
            "video/webm;codecs=h264,opus",
            "video/webm;codecs=h264",
            "video/webm",
        ];

        const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type)) || "video/mp4";

        try {
            const recorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: isMobile ? 800000 : 2500000, // Reduced bitrate: 0.8 Mbps for mobile, 2.5 Mbps for desktop
            });

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                setRecorderState({ isRecording: false, videoBlob: blob });
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
    }, [videoRef, audioStream]);

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
        setFailOverlay,
    };
};
