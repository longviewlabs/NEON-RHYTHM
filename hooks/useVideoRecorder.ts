import { useRef, useState, useCallback, useEffect } from "react";

interface RecorderState {
    isRecording: boolean;
    videoBlob: Blob | null;
}

export interface FailOverlayInfo {
    show: boolean;
    round: number;
}

export const useVideoRecorder = (videoRef: React.RefObject<HTMLVideoElement>, audioStream?: MediaStream | null, currentRound?: number, currentBpm?: number) => {
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
    const currentRoundRef = useRef<number>(currentRound || 1);
    const currentBpmRef = useRef<number>(currentBpm || 95);
    const stopTimeoutRef = useRef<number | null>(null);

    // Update refs when props change
    useEffect(() => {
        if (currentRound !== undefined) currentRoundRef.current = currentRound;
    }, [currentRound]);

    useEffect(() => {
        if (currentBpm !== undefined) currentBpmRef.current = currentBpm;
    }, [currentBpm]);

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
        // Clear any pending stop timeout from previous session
        if (stopTimeoutRef.current !== null) {
            clearTimeout(stopTimeoutRef.current);
            stopTimeoutRef.current = null;
        }

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

            // 3. Draw Top Text - "Only 1% people can do this...."
            ctx.save();
            if (!isMobile) {
                ctx.shadowColor = "rgba(0,0,0,0.7)";
                ctx.shadowBlur = 6;
            }
            ctx.fillStyle = "white";
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            ctx.lineWidth = 4;
            const topFontSize = isMobile ? 18 : 24; // Slightly larger for impact
            ctx.font = `900 ${topFontSize}px Inter, sans-serif`;
            ctx.textAlign = "center";
            const hookText = "Most people fail at Round 3";
            ctx.strokeText(hookText, canvas.width / 2, 60);
            ctx.fillText(hookText, canvas.width / 2, 60);
            ctx.restore();

            // 4. Draw Bottom Right Watermark - "FINGERRHYTHM.COM" with colors
            ctx.save();
            if (!isMobile) {
                ctx.shadowColor = "rgba(0,0,0,0.5)";
                ctx.shadowBlur = 6;
            }
            const watermarkFontSize = isMobile ? 14 : 18;
            ctx.font = `900 ${watermarkFontSize}px Inter, sans-serif`;
            ctx.textAlign = "right";

            // Measure each part to position correctly
            const fingerText = "FINGER";
            const rhythmText = "RHYTHM";
            const comText = ".COM";
            const fingerWidth = ctx.measureText(fingerText).width;
            const rhythmWidth = ctx.measureText(rhythmText).width;
            const comWidth = ctx.measureText(comText).width;

            const totalWatermarkWidth = fingerWidth + rhythmWidth + comWidth;
            const startX = canvas.width - 20 - totalWatermarkWidth;
            const bottomY = canvas.height - 20;

            // Draw FINGER in red
            ctx.fillStyle = "#fff";
            ctx.textAlign = "left";
            ctx.fillText(fingerText, startX, bottomY);

            // Draw RHYTHM in dark gray with white stroke
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            ctx.strokeText(rhythmText, startX + fingerWidth, bottomY);
            ctx.fillStyle = "#262626";
            ctx.fillText(rhythmText, startX + fingerWidth, bottomY);

            // Draw .COM in red
            ctx.fillStyle = "#fff";
            ctx.fillText(comText, startX + fingerWidth + rhythmWidth, bottomY);
            ctx.restore();

            // 5. Draw Fail Overlays
            const failInfo = failInfoRef.current;
            if (failInfo.show) {
                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height * 0.35);
                ctx.rotate(-10 * Math.PI / 180); // Match UI rotation (-10deg)

                // 1. Draw "FAIL"
                if (!isMobile) {
                    ctx.shadowColor = "rgba(220, 38, 38, 0.8)";
                    ctx.shadowBlur = 40;
                }
                ctx.fillStyle = "#dc2626";
                ctx.font = "900 150px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("FAIL", 0, 0);

                // 2. Draw Subheadline "Made it to Round X"
                const subHeadline = `MADE IT TO ROUND ${failInfo.round}`;

                // Align with left edge of FAIL
                ctx.font = "900 150px Inter, sans-serif";
                const failWidth = ctx.measureText("FAIL").width;
                const leftEdge = (-failWidth / 2) + 4;

                // Dynamically calculate font size to match FAIL width
                ctx.font = `900 30px Inter, sans-serif`;
                const currentWidth = ctx.measureText(subHeadline).width;
                const subFontSize = Math.floor(30 * (failWidth / currentWidth));

                ctx.font = `900 ${subFontSize}px Inter, sans-serif`;
                ctx.fillStyle = "white";

                // shadow for contrast
                ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                ctx.shadowBlur = 4;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;

                ctx.textAlign = "left";
                // Positioned tightly under FAIL (was 65)
                ctx.fillText(subHeadline, leftEdge, 55);
                ctx.restore();
            }

            const lines = preSplitLinesRef.current;

            // 5.5 Draw Countdown (if active)
            const countdownLine = lines.find(line => line.startsWith("COUNTDOWN:"));
            if (countdownLine) {
                const count = countdownLine.split(":")[1];
                ctx.save();
                ctx.font = "900 180px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "white";
                if (!isMobile) {
                    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                    ctx.shadowBlur = 30;
                }
                ctx.fillText(count, canvas.width / 2, canvas.height / 2);
                ctx.restore();
            }

            // 6. Draw Game Overlay Text - Round info + sequence centered in middle

            // Show overlay text only if we have lines
            if (lines.length > 0) {
                ctx.save();
                if (!isMobile) {
                    ctx.shadowColor = "black";
                    ctx.shadowBlur = 8;
                }
                ctx.fillStyle = "white";
                ctx.strokeStyle = "rgba(0,0,0,0.7)";
                ctx.lineWidth = 4;

                const roundFontSize = isMobile ? 24 : 32;
                const seqFontSize = roundFontSize; // Same as round text
                ctx.textAlign = "center";

                // Find the sequence line (contains numbers with spaces or brackets, but NOT "ROUND" lines)
                const sequenceLine = lines.find(line =>
                    !line.startsWith("ROUND") &&
                    /\d/.test(line) &&
                    (line.includes(" ") || line.includes("[["))
                );

                // Calculate layout
                const maxWidth = canvas.width - 40; // 20px padding on each side
                const wrappedSeqLines: string[] = [];

                if (sequenceLine && !failInfo.show) {
                    ctx.font = `900 ${seqFontSize}px Inter, sans-serif`;
                    // Convert spaces to dashes for display (e.g., "1 2 [[3]] 4" -> "1-2-[[3]]-4")
                    const sequenceWithDashes = sequenceLine.replace(/ /g, "-");
                    // Split by dash but keep the dash in display
                    const sequenceItems = sequenceWithDashes.split("-");
                    let currentLine = "";

                    for (let i = 0; i < sequenceItems.length; i++) {
                        const item = sequenceItems[i];
                        const separator = i > 0 ? "-" : "";
                        const testLine = currentLine ? `${currentLine}${separator}${item}` : item;
                        const cleanTest = testLine.replace(/\[\[|\]\]/g, "");
                        if (ctx.measureText(cleanTest).width > maxWidth && currentLine) {
                            wrappedSeqLines.push(currentLine);
                            currentLine = item;
                        } else {
                            currentLine = testLine;
                        }
                    }
                    if (currentLine) wrappedSeqLines.push(currentLine);
                }

                // Calculate total height: sequence lines only
                const seqLineHeight = seqFontSize * 1.5;
                const totalHeight = wrappedSeqLines.length * seqLineHeight;
                const startY = (canvas.height - totalHeight) / 2;

                // Draw sequence lines
                if (wrappedSeqLines.length > 0) {
                    ctx.font = `900 ${seqFontSize}px Inter, sans-serif`;
                    const seqStartY = startY + seqFontSize / 2;

                    wrappedSeqLines.forEach((line, lineIndex) => {
                        const y = seqStartY + lineIndex * seqLineHeight;
                        const x = canvas.width / 2;

                        if (line.includes("[[") && line.includes("]]")) {
                            // Split by brackets but keep the bracket content
                            const segments = line.split(/(\[\[.*?\]\])/g);
                            const cleanLine = line.replace(/\[\[|\]\]/g, "");
                            const lineWidth = ctx.measureText(cleanLine).width;
                            let currentX = x - lineWidth / 2;

                            segments.forEach((segment) => {
                                if (!segment) return;
                                if (segment.startsWith("[[") && segment.endsWith("]]")) {
                                    // Highlighted number (current beat)
                                    const text = segment.slice(2, -2);
                                    ctx.fillStyle = "#FACC15";
                                    // Temporarily removed stroke
                                    // const originalStroke = ctx.strokeStyle;
                                    // const originalLineWidth = ctx.lineWidth;
                                    // ctx.strokeStyle = "rgba(0,0,0,1.0)";
                                    // ctx.lineWidth = 3;
                                    // ctx.strokeText(text, currentX + ctx.measureText(text).width / 2, y);
                                    ctx.fillText(text, currentX + ctx.measureText(text).width / 2, y);
                                    // ctx.strokeStyle = originalStroke;
                                    // ctx.lineWidth = originalLineWidth;
                                    currentX += ctx.measureText(text).width;
                                } else {
                                    // Normal text (numbers and dashes)
                                    ctx.fillStyle = "white";
                                    // Temporarily removed stroke
                                    // ctx.strokeText(segment, currentX + ctx.measureText(segment).width / 2, y);
                                    ctx.fillText(segment, currentX + ctx.measureText(segment).width / 2, y);
                                    currentX += ctx.measureText(segment).width;
                                }
                            });
                        } else {
                            ctx.fillStyle = "white";
                            // Temporarily removed stroke
                            // ctx.strokeText(line, x, y);
                            ctx.fillText(line, x, y);
                        }
                    });
                }
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
        // Clear any pending stop timeout
        if (stopTimeoutRef.current !== null) {
            clearTimeout(stopTimeoutRef.current);
            stopTimeoutRef.current = null;
        }

        return new Promise<void>((resolve) => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                // Wait for the stop event to complete before resolving
                const recorder = mediaRecorderRef.current;
                const handleStop = () => {
                    recorder.removeEventListener('stop', handleStop);
                    resolve();
                };
                recorder.addEventListener('stop', handleStop);
                recorder.stop();
            } else {
                resolve();
            }
        });
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
