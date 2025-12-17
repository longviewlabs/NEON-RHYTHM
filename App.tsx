/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useMediaPipe } from './hooks/useMediaPipe';
import Robot from './components/Robot';
import WebcamPreview from './components/WebcamPreview';
import { GoogleGenAI } from "@google/genai";
import { DIFFICULTIES, Difficulty, GameStatus, RobotState, GeminiResponse } from './types';
import { RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { MUSIC_INTRO_URL, MUSIC_GAME_URL, MUSIC_SCORE_URL, BASE_BPM } from './constants';

const App: React.FC = () => {
    // Hardware Refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    
    // Audio Buffers & Source
    const introBufferRef = useRef<AudioBuffer | null>(null);
    const gameBufferRef = useRef<AudioBuffer | null>(null);
    const scoreBufferRef = useRef<AudioBuffer | null>(null);
    const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const currentGainRef = useRef<GainNode | null>(null);
    
    // Tracking
    const { isCameraReady, fingerCount, landmarksRef } = useMediaPipe(videoRef);
    
    // Ref to track finger count inside intervals/closures
    const fingerCountRef = useRef(0);
    useEffect(() => {
        fingerCountRef.current = fingerCount;
    }, [fingerCount]);

    // Game State
    const [status, setStatus] = useState<GameStatus>(GameStatus.MENU);
    const [difficulty, setDifficulty] = useState<Difficulty>('EASY');
    const [sequence, setSequence] = useState<number[]>([]);
    const [currentBeat, setCurrentBeat] = useState(-1);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [capturedFrames, setCapturedFrames] = useState<string[]>([]);
    const [isMuted, setIsMuted] = useState(false);
    
    // Real-time Results
    const [localResults, setLocalResults] = useState<(boolean | null)[]>([]);

    // Analysis Results (Gemini)
    const [robotState, setRobotState] = useState<RobotState>('average');
    const [resultData, setResultData] = useState<GeminiResponse | null>(null);

    // Generate random sequence based on difficulty
    const generateSequence = useCallback((diff: Difficulty) => {
        const config = DIFFICULTIES[diff];
        return Array.from({ length: config.length }, () => Math.floor(Math.random() * 5) + 1);
    }, []);

    // --- AUDIO SYSTEM ---
    const loadAudioBuffer = async (url: string, ctx: AudioContext): Promise<AudioBuffer | null> => {
        try {
            const res = await fetch(url);
            const arrayBuffer = await res.arrayBuffer();
            return await ctx.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.error(`Failed to load audio: ${url}`, e);
            return null;
        }
    };

    const initAudio = useCallback(async () => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;

        // Load all tracks
        if (!introBufferRef.current) introBufferRef.current = await loadAudioBuffer(MUSIC_INTRO_URL, ctx);
        if (!gameBufferRef.current) gameBufferRef.current = await loadAudioBuffer(MUSIC_GAME_URL, ctx);
        if (!scoreBufferRef.current) scoreBufferRef.current = await loadAudioBuffer(MUSIC_SCORE_URL, ctx);
    }, []);

    // Initialize audio on mount/interaction
    useEffect(() => {
        const handleInteraction = () => {
             initAudio().then(() => {
                 if (status === GameStatus.MENU) {
                     playTrack('intro');
                 }
             });
             window.removeEventListener('click', handleInteraction);
        };
        window.addEventListener('click', handleInteraction);
        return () => window.removeEventListener('click', handleInteraction);
    }, []);

    // Generic Play Track Function (mute only affects background music)
    const playTrack = useCallback((type: 'intro' | 'game' | 'score') => {
        if (!audioCtxRef.current) return;
        
        // Stop currently playing track
        if (currentSourceRef.current) {
            try { currentSourceRef.current.stop(); } catch(e) {}
            currentSourceRef.current = null;
        }

        const ctx = audioCtxRef.current;
        let buffer: AudioBuffer | null = null;
        let volume = 0.5;
        let loop = true;
        let playbackRate = 1.0;

        switch (type) {
            case 'intro':
                buffer = introBufferRef.current;
                volume = 0.2;
                break;
            case 'game':
                buffer = gameBufferRef.current;
                volume = 0.5;
                // Pitch shift for game difficulty
                const targetBPM = DIFFICULTIES[difficulty].bpm;
                playbackRate = targetBPM / BASE_BPM;
                break;
            case 'score':
                buffer = scoreBufferRef.current;
                volume = 0.2;
                break;
        }

        if (buffer) {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = loop;
            source.playbackRate.value = playbackRate;

            const gain = ctx.createGain();
            // Set volume to 0 if muted, otherwise use the normal volume
            gain.gain.value = isMuted ? 0 : volume;

            source.connect(gain);
            gain.connect(ctx.destination);
            source.start(0);
            currentSourceRef.current = source;
            currentGainRef.current = gain; // Store gain reference for mute control
        }
    }, [isMuted, difficulty]);

    const stopMusic = useCallback(() => {
        if (currentSourceRef.current) {
            try { currentSourceRef.current.stop(); } catch(e) {}
            currentSourceRef.current = null;
        }
        currentGainRef.current = null;
    }, []);

    // Effect to switch music based on state (except Playing, which is handled in startGame)
    useEffect(() => {
        if (!audioCtxRef.current) return;

        if (status === GameStatus.MENU) {
            playTrack('intro');
        } else if (status === GameStatus.RESULT || status === GameStatus.ANALYZING) {
            playTrack('score');
        }
    }, [status, playTrack]);

    // Update volume of currently playing music when mute state changes
    useEffect(() => {
        if (!currentGainRef.current || !audioCtxRef.current) return;
        
        const gain = currentGainRef.current;
        const ctx = audioCtxRef.current;
        
        // Determine the target volume based on current track type
        let targetVolume = 0.5;
        if (status === GameStatus.MENU && introBufferRef.current) {
            targetVolume = 0.2;
        } else if ((status === GameStatus.RESULT || status === GameStatus.ANALYZING) && scoreBufferRef.current) {
            targetVolume = 0.2;
        } else if (status === GameStatus.PLAYING && gameBufferRef.current) {
            targetVolume = 0.5;
        }
        
        // Apply mute: set to 0 if muted, otherwise use target volume
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(isMuted ? 0 : targetVolume, now);
    }, [isMuted, status]);

    // Countdown beep: Matches index copy.html (always plays, not affected by mute)
    const playCountdownBeep = useCallback((count: number) => {
        if (!audioCtxRef.current) return;
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 400 + (count * 100); // Pitch shift based on count
        gain.gain.value = 0.1;
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    }, []);

    // Metronome sound: Matches index copy.html rhythm engine (always plays, not affected by mute)
    const playTick = useCallback((beatNumber: number) => {
        if (!audioCtxRef.current) return;
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const envelope = ctx.createGain();
        
        osc.connect(envelope);
        envelope.connect(ctx.destination);
        
        // Sound properties - match HTML version
        if (beatNumber === 0) {
            osc.frequency.value = 1200.0; // High sharp tick for beat 1
        } else {
            osc.frequency.value = 800.0;  // Lower tick
        }
        
        // Very short, percussive tick
        envelope.gain.value = 0.15;
        envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.05);
    }, []);

    // Success: Pleasant major chord chime
    const playSuccessSound = useCallback(() => {
        if (!audioCtxRef.current || isMuted) return;
        const ctx = audioCtxRef.current;
        const now = ctx.currentTime;

        // Create a simple major triad
        [523.25, 659.25, 783.99].forEach((freq, i) => { // C Major (C5, E5, G5)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.value = freq;
            
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3 + (i * 0.1));
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(now + 0.5);
        });
    }, [isMuted]);

    // Fail: Low buzzy saw wave
    const playFailSound = useCallback(() => {
        if (!audioCtxRef.current || isMuted) return;
        const ctx = audioCtxRef.current;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(50, now + 0.3);
        
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(now + 0.3);
    }, [isMuted]);

    // --- GAME LOOP ---
    const startGame = async () => {
        await initAudio();
        const newSequence = generateSequence(difficulty);
        setSequence(newSequence);
        setLocalResults(new Array(newSequence.length).fill(null));
        setCapturedFrames([]);
        setResultData(null);
        setStatus(GameStatus.PLAYING);
        setRobotState('average');
        setCurrentBeat(-1);
        
        // Start Game Music IMMEDIATELY (like in HTML version)
        playTrack('game');

        // Countdown with immediate start after 0
        let count = 3;
        setCountdown(count);
        playCountdownBeep(count);
        
        const timer = setInterval(() => {
            count--;
            setCountdown(count);
            
            if (count > 0) {
                playCountdownBeep(count);
            }
            
            if (count === 0) {
                clearInterval(timer);
                setCountdown(null);
                // Start sequence immediately - no delay
                runSequence(newSequence);
            }
        }, 1000);
    };

    const runSequence = (seq: number[]) => {
        // playMusic(); // Removed: Handled in startGame now
        const bpm = DIFFICULTIES[difficulty].bpm;
        const interval = 60000 / bpm;
        let beat = 0; // Start at 0
        const frames: string[] = [];
        const results: (boolean | null)[] = new Array(seq.length).fill(null);

        // Show first beat immediately when sequence starts
        setCurrentBeat(0);
        // Play metronome tick for beat 0 (first beat - accent)
        playTick(0);

        // Use consistent interval from the start - first callback happens after one interval
        const loop = setInterval(() => {
            // JUDGE THE PREVIOUS BEAT (The one we just finished showing)
            if (beat >= 0 && beat < seq.length) {
                // Capture Frame for Analysis
                if (videoRef.current && canvasRef.current) {
                    const canvas = canvasRef.current;
                    const video = videoRef.current;
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        frames.push(canvas.toDataURL('image/jpeg', 0.6));
                    }
                }

                // Immediate Local Judgment
                const detected = fingerCountRef.current;
                const target = seq[beat];
                const isHit = detected === target;
                results[beat] = isHit;
                setLocalResults([...results]); // Update UI

                if (isHit) playSuccessSound();
                else playFailSound();
            }

            // Increment to next beat
            beat++;

            // Check if we've shown all beats
            if (beat >= seq.length) {
                clearInterval(loop);
                // Last beat was already judged and captured in the loop above
                // Music transition handled by state change to ANALYZING/RESULT
                setCapturedFrames(frames);
                analyzeGame(seq, frames, results);
                return;
            }

            // Show current beat and play metronome tick
            setCurrentBeat(beat);
            // Calculate beat number in measure (0-3 pattern like HTML version)
            const beatInMeasure = beat % 4;
            playTick(beatInMeasure);
        }, interval);
    };

    const analyzeGame = async (seq: number[], frames: string[], localResults: (boolean | null)[]) => {
        setStatus(GameStatus.ANALYZING);
        // playTrack('score'); // Handled by useEffect monitoring status
        setRobotState('analyzing');
        
        // Calculate local score for fallback
        const localCorrectCount = localResults.filter(r => r === true).length;
        const localScore = Math.round((localCorrectCount / seq.length) * 100);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // Prepare image parts
            const imageParts = frames.map(dataUrl => ({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: dataUrl.split(',')[1]
                }
            }));

            const prompt = `
                You are a judge for a rhythm game.
                The player had to show a specific number of fingers for each beat.
                Target Sequence: [${seq.join(', ')}].
                I have provided ${frames.length} images, one captured for each beat.
                
                YOUR TASK:
                1. Count the extended fingers in each image. (0 for fist).
                2. Compare with the Target Sequence.
                3. Provide a strict judgment.
                
                Return JSON:
                {
                    "success": boolean (true if > 60% correct),
                    "correct_count": number,
                    "score": number (0-100),
                    "feedback": "Short witty comment (max 10 words)",
                    "detailed_results": [boolean array matching sequence length],
                    "detected_counts": [number array matching detected fingers]
                }
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: {
                    parts: [
                        { text: prompt },
                        ...imageParts
                    ]
                },
                config: {
                    responseMimeType: "application/json"
                }
            });

            const responseText = response.text;
            if (!responseText) throw new Error("Empty response from AI");
            
            const data: GeminiResponse = JSON.parse(responseText);
            
            setResultData(data);
            setRobotState(data.success ? 'happy' : 'sad');
            setStatus(GameStatus.RESULT);

        } catch (error) {
            console.error("Gemini Analysis Failed", error);
            // Fallback to local results if API fails
            setRobotState(localScore > 60 ? 'happy' : 'sad');
            setResultData({
                success: localScore > 60,
                correct_count: localCorrectCount,
                score: localScore,
                feedback: "AI Offline. Using local judgment.",
                detailed_results: localResults.map(r => r === true),
                detected_counts: seq.map(() => 0) // Placeholder
            });
            setStatus(GameStatus.RESULT);
        }
    };

    // --- RENDER ---
    const beatDuration = 60 / DIFFICULTIES[difficulty].bpm; // in seconds

    return (
        <div className="relative w-full h-screen bg-[#050510] overflow-hidden text-white font-sans selection:bg-[#ff00ff]">
            {/* Hidden Canvas for capture */}
            <canvas ref={canvasRef} className="hidden" />
            
            {/* Background Video */}
            <video 
                ref={videoRef} 
                className="absolute inset-0 w-full h-full object-cover opacity-30 scale-x-[-1]" 
                playsInline 
                muted 
                autoPlay
            />
            
            {/* SKELETON OVERLAY */}
            <WebcamPreview 
                videoRef={videoRef} 
                landmarksRef={landmarksRef} 
                isCameraReady={isCameraReady} 
            />

            {/* Overlay Gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#050510] via-transparent to-[#050510]/80 pointer-events-none" />

            {/* Mute Button */}
            <button 
                onClick={() => setIsMuted(!isMuted)} 
                className="absolute top-4 right-4 md:top-6 md:right-6 z-50 p-3 md:p-3 bg-white/10 rounded-full hover:bg-white/20 active:bg-white/30 transition-all pointer-events-auto touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
                {isMuted ? <VolumeX size={20} className="md:w-6 md:h-6" /> : <Volume2 size={20} className="md:w-6 md:h-6" />}
            </button>

            {/* DETECTED NUMBER - TOP CENTER */}
            {isCameraReady && status !== GameStatus.RESULT && (
                <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none">
                    <div className="text-[10px] md:text-[12px] text-[#00f3ff] tracking-[0.2em] md:tracking-[0.3em] font-bold mb-0.5 md:mb-1 uppercase text-glow">
                        Finger Count
                    </div>
                    <div className="text-5xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-[#00f3ff] drop-shadow-[0_0_15px_rgba(0,243,255,0.6)] md:drop-shadow-[0_0_20px_rgba(0,243,255,0.8)]">
                        {fingerCount}
                    </div>
                </div>
            )}

            {/* Main Content Container */}
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-3 md:p-4">
                
                {/* --- MENU STATE --- */}
                {status === GameStatus.MENU && (
                    <div className="flex flex-col items-center gap-4 md:gap-8 animate-pop w-full max-w-sm md:max-w-none">
                        <div className="text-center mt-8 md:mt-20">
                            <h1 className="text-4xl md:text-6xl lg:text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] to-[#ff00ff] drop-shadow-[0_0_10px_rgba(0,243,255,0.4)] md:drop-shadow-[0_0_15px_rgba(0,243,255,0.5)]">
                                NEON RHYTHM
                            </h1>
                            <p className="text-[#00f3ff] tracking-[0.2em] md:tracking-[0.3em] font-bold text-xs md:text-sm mt-1 md:mt-2">GESTURE BATTLE</p>
                        </div>

                        {/* Difficulty Selector - Improved Styling */}
                        <div className="flex flex-col gap-3 md:gap-4 w-full max-w-sm items-center px-2">
                            <div className="text-[10px] md:text-xs font-bold text-white/40 tracking-[0.15em] md:tracking-[0.2em] uppercase mb-2 md:mb-3 text-center">
                                CHOOSE YOUR DIFFICULTY
                            </div>
                            {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setDifficulty(d)}
                                    className={`
                                        w-full py-3 md:py-4 rounded-full text-xs md:text-sm font-black tracking-[0.15em] md:tracking-[0.2em] uppercase transition-all duration-300 border min-h-[44px] touch-manipulation active:scale-95
                                        ${difficulty === d 
                                            ? `bg-white/10 ${DIFFICULTIES[d].color} border-white/50 scale-105 shadow-[0_0_20px_rgba(255,255,255,0.15)]` 
                                            : 'bg-black/60 border-white/20 text-white/30 active:bg-white/5 active:text-white/80 active:scale-[0.98]'
                                        }
                                    `}
                                >
                                    {DIFFICULTIES[d].name}
                                </button>
                            ))}
                            <p className="text-[9px] md:text-[10px] uppercase font-mono text-white/30 mt-2 md:mt-4 tracking-wider md:tracking-widest">
                                {DIFFICULTIES[difficulty].length} ROUNDS • {DIFFICULTIES[difficulty].bpm} BPM
                            </p>
                        </div>

                        {!isCameraReady ? (
                            <div className="text-yellow-400 animate-pulse text-xs md:text-sm">Initializing Camera...</div>
                        ) : (
                            <button
                                onClick={startGame}
                                className="group relative px-6 md:px-10 py-4 md:py-5 rounded-full bg-gradient-to-r from-[#00f3ff] to-[#ff00ff] text-black font-black text-base md:text-xl italic tracking-wider md:tracking-widest active:scale-95 md:hover:scale-105 transition-transform shadow-[0_0_20px_rgba(0,243,255,0.3)] md:shadow-[0_0_30px_rgba(0,243,255,0.4)] min-h-[44px] touch-manipulation"
                            >
                                START GROOVE
                            </button>
                        )}
                    </div>
                )}

                {/* --- PLAYING STATE --- */}
                {(status === GameStatus.PLAYING || status === GameStatus.ANALYZING) && (
                    <div className="w-full h-full flex flex-col justify-between py-6 md:py-12">
                        {/* Status (Left) */}
                        <div className="absolute top-4 left-4 md:top-8 md:left-8">
                            <div className="glass-panel px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1.5 md:gap-2">
                                <div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-green-400 animate-pulse" />
                                <span className="text-[10px] md:text-xs font-bold tracking-wider md:tracking-widest">LIVE FEED</span>
                            </div>
                        </div>

                        {/* Center Stage - Countdown Above, Glass Bar Below */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center w-full z-40 pointer-events-none">
                            
                            {/* Countdown - Massive and centered */}
                            {countdown !== null && (
                                <div className="text-[8rem] md:text-[12rem] lg:text-[16rem] leading-none font-black italic text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] to-[#ff00ff] drop-shadow-[0_3px_3px_rgba(0,0,0,0.8)] md:drop-shadow-[0_5px_5px_rgba(0,0,0,1)] animate-pulse mb-6 md:mb-12 -translate-y-16 md:-translate-y-32 z-50">
                                    {countdown}
                                </div>
                            )}

                            {/* Active Sequence - Visible during PLAYING (including countdown) */}
                            {status === GameStatus.PLAYING && (
                                <div className="flex flex-col items-center animate-pop">
                                    
                                    {/* Glass Bar UI - Frosted glass effect */}
                                    <div className="px-3 py-2 md:px-6 md:py-3 rounded-xl md:rounded-2xl flex flex-wrap justify-center items-center gap-1.5 md:gap-2 max-w-[95vw] bg-white/10 backdrop-blur-md border border-white/10 shadow-[0_0_20px_rgba(0,0,0,0.2)] md:shadow-[0_0_30px_rgba(0,0,0,0.3)]">
                                        {sequence.map((num, idx) => {
                                            const isPast = idx < currentBeat;
                                            const isCurrent = idx === currentBeat;
                                            const result = localResults[idx];
                                            
                                            // During countdown, show all numbers dimmed
                                            let textClass = 'text-white/30 font-black text-2xl md:text-4xl transition-all duration-200';
                                            let containerClass = 'w-8 h-10 md:w-12 md:h-16 flex justify-center items-center transform transition-all duration-200';

                                            if (countdown === null) {
                                                // Game started - show dynamic states
                                                if (result === true) {
                                                    textClass = 'text-[#00f3ff] text-glow font-black text-2xl md:text-4xl';
                                                    containerClass += ' scale-100';
                                                } else if (result === false) {
                                                    textClass = 'text-[#ff00ff] text-glow-pink font-black text-2xl md:text-4xl opacity-50';
                                                    containerClass += ' scale-90';
                                                } else if (isCurrent) {
                                                    textClass = 'text-white text-glow font-black text-4xl md:text-6xl drop-shadow-[0_0_10px_rgba(255,255,255,0.6)] md:drop-shadow-[0_0_15px_rgba(255,255,255,0.8)]';
                                                    containerClass += ' scale-110 -translate-y-1 md:-translate-y-1.5 z-10';
                                                }
                                            } else {
                                                // During countdown - show all numbers in white/40 with subtle pulse
                                                textClass = 'text-white/40 font-black text-2xl md:text-4xl animate-pulse';
                                            }

                                            return (
                                                <div key={idx} className={containerClass}>
                                                    <span className={textClass}>
                                                        {num}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    
                                    {/* BPM Indicator - Centered below glass bar */}
                                    <div className="mt-2 md:mt-4 flex items-center justify-center gap-2 md:gap-4">
                                         <div className="h-px w-16 md:w-24 bg-gray-800 rounded-full overflow-hidden mx-auto">
                                            <div className="h-full bg-[#00f3ff] w-0"></div>
                                         </div>
                                    </div>
                                    <p className="text-[9px] md:text-[10px] font-mono text-[#00f3ff]/80 tracking-wider md:tracking-widest mt-0.5 md:mt-1">
                                        {DIFFICULTIES[difficulty].bpm} BPM
                                    </p>

                                </div>
                            )}

                            {/* Robot Analysis */}
                            {status === GameStatus.ANALYZING && (
                                <div className="flex flex-col items-center gap-4 md:gap-6 animate-pop px-4">
                                    <Robot state="analyzing" />
                                    <h2 className="text-2xl md:text-4xl font-black uppercase text-glow animate-pulse">ANALYZING...</h2>
                                    <p className="text-white/60 text-xs md:text-sm text-center">The AI Judge is watching your moves</p>
                                </div>
                            )}
                        </div>

                    </div>
                )}

                {/* --- RESULT STATE --- */}
                {status === GameStatus.RESULT && resultData && (
                    <div className="flex flex-col items-center gap-4 md:gap-6 w-full max-w-4xl animate-pop px-3 md:px-4 overflow-y-auto pb-4">
                        <Robot state={robotState} />
                        
                        <h1 className={`text-5xl md:text-7xl lg:text-9xl font-black ${resultData.success ? 'text-[#00f3ff] text-glow' : 'text-[#ff00ff] text-glow-pink'} animate-pop`}>
                            {resultData.correct_count} / {sequence.length}
                        </h1>

                        {/* Detailed Results Panel */}
                        <div className="glass-panel p-4 md:p-6 rounded-2xl md:rounded-3xl bg-white/5 backdrop-blur-md border border-white/10 w-full">
                            <div className="text-left text-[10px] md:text-xs uppercase font-bold text-white/50 mb-3 md:mb-4 tracking-wider md:tracking-widest">
                                VERDICT
                            </div>
                            
                            {/* Grid of Results */}
                            <div className="flex gap-1.5 md:gap-2 mb-4 md:mb-6 justify-center flex-wrap">
                                {sequence.map((target, idx) => {
                                    const isHit = resultData.detailed_results[idx];
                                    const detected = resultData.detected_counts[idx];
                                    const colorClass = isHit 
                                        ? 'border-[#00f3ff] bg-[#00f3ff]/20 shadow-[0_0_10px_#00f3ff] md:shadow-[0_0_15px_#00f3ff]' 
                                        : 'border-[#ff00ff] bg-[#ff00ff]/10';
                                    const textClass = isHit ? 'text-[#00f3ff]' : 'text-[#ff00ff]';
                                    const label = isHit ? 'HIT' : 'MISS';
                                    
                                    return (
                                        <div key={idx} className={`w-12 h-16 md:w-16 md:h-24 border-2 ${colorClass} rounded-lg md:rounded-xl flex flex-col items-center justify-center backdrop-blur-sm transform transition-all active:scale-95 md:hover:scale-110`}>
                                            <span className={`text-2xl md:text-4xl font-black ${textClass} mb-0.5 md:mb-1`}>
                                                {target}
                                            </span>
                                            <span className={`text-[9px] md:text-xs uppercase font-black tracking-wider ${textClass}`}>
                                                {label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* AI Feedback Quote */}
                            <div className="text-base md:text-xl italic mb-3 md:mb-4 text-center px-2">
                                "{resultData.feedback}"
                            </div>

                            {/* Captured Frames Grid */}
                            <div className="flex gap-1.5 md:gap-2 justify-center flex-wrap mt-3 md:mt-4">
                                {capturedFrames.map((frame, idx) => {
                                    const isHit = resultData.detailed_results[idx];
                                    const borderColor = isHit ? 'border-[#00f3ff] shadow-[0_0_8px_#00f3ff] md:shadow-[0_0_10px_#00f3ff]' : 'border-[#ff00ff]/50';
                                    const badgeColor = isHit ? 'bg-[#00f3ff]' : 'bg-[#ff00ff]';
                                    const detected = resultData.detected_counts[idx] ?? '?';
                                    
                                    return (
                                        <div key={idx} className={`relative w-16 h-20 md:w-20 md:h-28 rounded-md md:rounded-lg overflow-hidden border-2 ${borderColor} bg-black/50 active:scale-125 md:hover:scale-150 active:z-50 md:hover:z-50 transition-transform origin-bottom duration-300 group touch-manipulation`}>
                                            <img src={frame} alt={`frame ${idx + 1}`} className="w-full h-full object-cover opacity-80 group-hover:opacity-100" />
                                            <div className="absolute top-0.5 right-0.5 md:top-1 md:right-1 bg-black/40 backdrop-blur-sm rounded text-[7px] md:text-[8px] text-white/50 px-1 md:px-1.5 py-0.5 font-mono border border-white/10">
                                                #{idx + 1}
                                            </div>
                                            <div className={`absolute bottom-0 w-full ${badgeColor} py-0.5 md:py-1 flex justify-center shadow-[0_-2px_8px_rgba(0,0,0,0.2)] md:shadow-[0_-2px_10px_rgba(0,0,0,0.3)]`}>
                                                <span className="text-[8px] md:text-[10px] font-bold text-white uppercase tracking-wider">
                                                    SAW: {detected}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-6 md:gap-8 mt-3 md:mt-4">
                            <button 
                                onClick={startGame}
                                className="text-white/40 text-[11px] md:text-xs font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] active:text-white md:hover:text-white transition-colors border-b border-white/0 active:border-white/50 md:hover:border-white/50 pb-1 min-h-[44px] touch-manipulation"
                            >
                                Try Again
                            </button>
                            <button 
                                onClick={() => setStatus(GameStatus.MENU)}
                                className="text-white/40 text-[11px] md:text-xs font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] active:text-white md:hover:text-white transition-colors border-b border-white/0 active:border-white/50 md:hover:border-white/50 pb-1 min-h-[44px] touch-manipulation"
                            >
                                Back to Menu
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default App;