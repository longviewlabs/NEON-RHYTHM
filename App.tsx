/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useMediaPipe } from "./hooks/useMediaPipe";
import Robot from "./components/Robot";
import WebcamPreview from "./components/WebcamPreview";
import SettingsModal from "./components/SettingsModal";
import { GoogleGenAI } from "@google/genai";
import {
  DIFFICULTIES,
  Difficulty,
  GameStatus,
  RobotState,
  GeminiResponse,
} from "./types";
import { RotateCcw, Volume2, VolumeX, Settings } from "lucide-react";
import {
  MUSIC_INTRO_URL,
  MUSIC_GAME_URL,
  MUSIC_SCORE_URL,
  BASE_BPM,
  AUDIO_OFFSET_MS,
  FIRST_BEAT_TIME_SEC,
} from "./constants";

// Initialize AI outside component to avoid re-instantiation memory overhead
let genAIInstance: GoogleGenAI | null = null;
const getAI = (apiKey: string) => {
  if (!genAIInstance) genAIInstance = new GoogleGenAI({ apiKey });
  return genAIInstance;
};

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

  // Memory & Timer Management
  const gameTimersRef = useRef<(number | NodeJS.Timeout)[]>([]);

  // Tracking
  const { isCameraReady, fingerCount, landmarksRef } = useMediaPipe(videoRef);

  // Ref to track if target was hit at any point during the beat (Mobile optimization)
  const hasHitCurrentBeatRef = useRef(false);

  // Ref to track finger count inside intervals/closures
  const fingerCountRef = useRef(0);

  // Game State
  const [status, setStatus] = useState<GameStatus>(GameStatus.LOADING);
  const [difficulty, setDifficulty] = useState<Difficulty>("EASY");
  const [sequence, setSequence] = useState<number[]>([]);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<string[]>([]);
  const [judgementMode, setJudgementMode] = useState<"LOCAL" | "AI">("AI");
  const [isMuted, setIsMuted] = useState(false);
  const [showFingerVector, setShowFingerVector] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Loading State
  const [isAssetsReady, setIsAssetsReady] = useState(false);

  // Real-time Results
  const [localResults, setLocalResults] = useState<(boolean | null)[]>([]);

  // Analysis Results (Gemini)
  const [robotState, setRobotState] = useState<RobotState>("average");
  const [resultData, setResultData] = useState<GeminiResponse | null>(null);

  // Memory Cleanup: Clear all temp data, timers and frames
  const cleanupTempData = useCallback(() => {
    // Clear all ghost loops and timers
    gameTimersRef.current.forEach((id) => {
      if (id) {
        clearInterval(id as any);
        clearTimeout(id as any);
      }
    });
    gameTimersRef.current = [];

    // Reset heavy state
    setCapturedFrames([]);
    setLocalResults([]);
    setCurrentBeat(-1);
    hasHitCurrentBeatRef.current = false;
  }, []);

  // Sync finger count ref and check for hits
  useEffect(() => {
    fingerCountRef.current = fingerCount;

    // If we are playing, check if this new count matches the current target
    if (
      status === GameStatus.PLAYING &&
      currentBeat >= 0 &&
      currentBeat < sequence.length
    ) {
      if (fingerCount === sequence[currentBeat]) {
        hasHitCurrentBeatRef.current = true;
      }
    }
  }, [fingerCount, status, currentBeat, sequence]);

  // Generate random sequence based on difficulty
  const generateSequence = useCallback((diff: Difficulty) => {
    const config = DIFFICULTIES[diff];
    return Array.from(
      { length: config.length },
      () => Math.floor(Math.random() * 5) + 1
    );
  }, []);

  // --- AUDIO SYSTEM ---
  const loadAudioBuffer = async (
    url: string,
    ctx: AudioContext
  ): Promise<AudioBuffer | null> => {
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
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioCtxRef.current = new AudioContextClass();
        }
      }

      const ctx = audioCtxRef.current;
      if (!ctx) return;

      // Load all tracks in parallel
      const [intro, game, score] = await Promise.all([
        introBufferRef.current
          ? Promise.resolve(introBufferRef.current)
          : loadAudioBuffer(MUSIC_INTRO_URL, ctx),
        gameBufferRef.current
          ? Promise.resolve(gameBufferRef.current)
          : loadAudioBuffer(MUSIC_GAME_URL, ctx),
        scoreBufferRef.current
          ? Promise.resolve(scoreBufferRef.current)
          : loadAudioBuffer(MUSIC_SCORE_URL, ctx),
      ]);

      introBufferRef.current = intro;
      gameBufferRef.current = game;
      scoreBufferRef.current = score;
    } catch (error) {
      console.error("Audio initialization failed:", error);
    }
  }, []);

  // Helper to resume audio context - CRITICAL for iOS
  const resumeAudio = useCallback(async () => {
    if (!audioCtxRef.current) {
      await initAudio();
    }

    const ctx = audioCtxRef.current;
    if (ctx) {
      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        await ctx.resume();
      }

      // iOS "Silent Mode" & "User Gesture" Unlock:
      // Play a tiny silent buffer to kickstart the hardware
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    }
  }, [initAudio]);

  // Start loading assets immediately on mount
  useEffect(() => {
    const loadAssets = async () => {
      await initAudio();
      setIsAssetsReady(true);
    };
    loadAssets();
  }, [initAudio]);

  // Generic Play Track Function (mute only affects background music)
  // startOffset: time in seconds to start playback from (for skipping intros)
  const playTrack = useCallback(
    (type: "intro" | "game" | "score", startOffset: number = 0) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      // Stop currently playing track
      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.stop();
        } catch (e) {}
        currentSourceRef.current = null;
      }

      let buffer: AudioBuffer | null = null;
      let volume = 0.5;
      let loop = true;
      let playbackRate = 1.0;
      let offset = startOffset;

      switch (type) {
        case "intro":
          buffer = introBufferRef.current;
          volume = 0.2;
          offset = 0;
          break;
        case "game":
          buffer = gameBufferRef.current;
          volume = 0.5;
          const targetBPM = DIFFICULTIES[difficulty].bpm;
          playbackRate = targetBPM / BASE_BPM;
          offset = startOffset / playbackRate;
          break;
        case "score":
          buffer = scoreBufferRef.current;
          volume = 0.2;
          offset = 0;
          break;
      }

      if (buffer) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value = playbackRate;

        const gain = ctx.createGain();
        gain.gain.value = isMuted ? 0 : volume;

        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0, offset);
        currentSourceRef.current = source;
        currentGainRef.current = gain;
      }
    },
    [isMuted, difficulty]
  );

  const stopMusic = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {}
      currentSourceRef.current = null;
    }
    currentGainRef.current = null;
  }, []);

  // Handle "Enter Studio" button click
  const handleEnterStudio = useCallback(async () => {
    if (!isAssetsReady) return;

    // 1. Resume Context immediately on user click
    const ctx = audioCtxRef.current;
    if (ctx && (ctx.state === "suspended" || ctx.state === "interrupted")) {
      await ctx.resume();
    }

    // 2. Play intro music immediately inside the same click handler
    playTrack("intro");

    setStatus(GameStatus.MENU);
  }, [isAssetsReady, playTrack]);

  // Effect to switch music based on state (except Playing, which is handled in startGame)
  useEffect(() => {
    if (!audioCtxRef.current) return;

    // Removed GameStatus.MENU auto-play to prevent redundant triggers
    // we now trigger it manually in handleEnterStudio and startGame
    if (status === GameStatus.RESULT || status === GameStatus.ANALYZING) {
      playTrack("score");
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
    } else if (
      (status === GameStatus.RESULT || status === GameStatus.ANALYZING) &&
      scoreBufferRef.current
    ) {
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
    osc.frequency.value = 400 + count * 100; // Pitch shift based on count
    gain.gain.value = 0.1;
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);

    osc.start();
    osc.stop(ctx.currentTime + 0.1);

    // Disconnect nodes to free memory after sound ends
    setTimeout(() => {
      osc.disconnect();
      gain.disconnect();
    }, 200);
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
      osc.frequency.value = 800.0; // Lower tick
    }

    // Very short, percussive tick
    envelope.gain.value = 0.15;
    envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);

    // Disconnect nodes to free memory
    setTimeout(() => {
      osc.disconnect();
      envelope.disconnect();
    }, 100);
  }, []);

  // Success: Pleasant major chord chime
  const playSuccessSound = useCallback(() => {
    if (!audioCtxRef.current || isMuted) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;

    // Create a simple major triad
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      // C Major (C5, E5, G5)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3 + i * 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(now + 0.5);

      // Cleanup
      setTimeout(() => {
        osc.disconnect();
        gain.disconnect();
      }, 600);
    });
  }, [isMuted]);

  // Fail: Low buzzy saw wave
  const playFailSound = useCallback(() => {
    if (!audioCtxRef.current || isMuted) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.linearRampToValueAtTime(50, now + 0.3);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(now + 0.3);

    // Cleanup
    setTimeout(() => {
      osc.disconnect();
      gain.disconnect();
    }, 400);
  }, [isMuted]);

  // --- GAME LOOP ---
  const startGame = async (forcedDifficulty?: Difficulty) => {
    cleanupTempData(); // Clear memory/timers from previous rounds

    const targetDifficulty = forcedDifficulty || difficulty;
    const newSequence = generateSequence(targetDifficulty);
    setSequence(newSequence);
    setLocalResults(new Array(newSequence.length).fill(null));
    setCapturedFrames([]);
    setResultData(null);
    setStatus(GameStatus.PLAYING);
    setRobotState("average");
    setCurrentBeat(-1);
    hasHitCurrentBeatRef.current = false;

    // Calculate timing based on difficulty's playback rate
    const targetBPM = DIFFICULTIES[targetDifficulty].bpm;
    const playbackRate = targetBPM / BASE_BPM;

    // Time until first beat at current playback rate
    const timeToFirstBeat = FIRST_BEAT_TIME_SEC / playbackRate;

    // We have a 3-second countdown, so:
    // - If first beat is at 3s (at 1x speed), start music immediately
    // - If first beat takes longer, delay music start
    // - If first beat comes sooner, start music from an offset

    const countdownDuration = 3; // 3 seconds countdown

    if (timeToFirstBeat >= countdownDuration) {
      // First beat comes after countdown - start music now, it will sync
      playTrack("game", 0);

      // Wait for the difference, then start countdown
      const waitTime = (timeToFirstBeat - countdownDuration) * 1000;
      const timerId = setTimeout(() => {
        startCountdown(newSequence);
      }, waitTime);
      gameTimersRef.current.push(timerId);
    } else {
      // First beat comes before countdown ends - skip intro
      // Start music from a point so first beat aligns with countdown end
      const skipAmount = FIRST_BEAT_TIME_SEC; // Skip the intro
      playTrack("game", skipAmount);

      // Start countdown immediately
      startCountdown(newSequence);
    }
  };

  // Separated countdown logic for cleaner code
  const startCountdown = (newSequence: number[]) => {
    let count = 3;
    setCountdown(count);
    playCountdownBeep(count);

    const timerId = setInterval(() => {
      count--;
      setCountdown(count);

      if (count > 0) {
        playCountdownBeep(count);
      }

      if (count === 0) {
        clearInterval(timerId);
        setCountdown(null);
        // Start sequence immediately - synced with first beat!
        runSequence(newSequence);
      }
    }, 1000);
    gameTimersRef.current.push(timerId);
  };

  const runSequence = (seq: number[]) => {
    // playMusic(); // Removed: Handled in startGame now
    const bpm = DIFFICULTIES[difficulty].bpm;
    const interval = 60000 / bpm;
    let beat = 0; // Start at 0
    const frames: string[] = [];
    const results: (boolean | null)[] = new Array(seq.length).fill(null);

    // Pre-set canvas size for optimized capture (Low res is enough for AI)
    if (canvasRef.current) {
      canvasRef.current.width = 320;
      canvasRef.current.height = 240;
    }

    // Start the beat loop after audio offset for perfect sync
    const startBeatLoop = () => {
      // Show first beat immediately when sequence starts
      setCurrentBeat(0);

      const captureFrame = () => {
        if (videoRef.current && canvasRef.current) {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, 320, 240);
            return canvas.toDataURL("image/jpeg", 0.5);
          }
        }
        return null;
      };

      // Trigger bursts for a specific beat
      const triggerBurst = (beatIdx: number) => {
        const offsets = [0.25, 0.5, 0.75];
        offsets.forEach((offset) => {
          const timerId = setTimeout(() => {
            const frame = captureFrame();
            if (frame) frames.push(frame);
          }, interval * offset);
          gameTimersRef.current.push(timerId);
        });
      };

      // Initial burst for first beat
      triggerBurst(0);

      // Use consistent interval from the start - first callback happens after one interval
      const loopId = setInterval(() => {
        // JUDGE THE PREVIOUS BEAT (The one we just finished showing)
        if (beat >= 0 && beat < seq.length) {
          // JUDGMENT: Use the "hasHit" flag which caught the gesture at any point in the beat
          const isHit = hasHitCurrentBeatRef.current;
          results[beat] = isHit;
          setLocalResults([...results]); // Update UI

          if (isHit) playSuccessSound();
          else playFailSound();
        }

        // Increment to next beat
        beat++;
        hasHitCurrentBeatRef.current = false; // Reset for the new beat

        // Check if we've shown all beats
        if (beat >= seq.length) {
          clearInterval(loopId);
          // Small delay to ensure the last burst capture ('After') is finished
          const finishTimer = setTimeout(() => {
            setCapturedFrames(frames);
            analyzeGame(seq, frames, results);
          }, interval * 0.8);
          gameTimersRef.current.push(finishTimer);
          return;
        }

        // Show current beat and trigger its burst
        setCurrentBeat(beat);
        triggerBurst(beat);
      }, interval);
      gameTimersRef.current.push(loopId);
    };

    // Apply audio offset for sync - if 0, start immediately
    if (AUDIO_OFFSET_MS > 0) {
      const timerId = setTimeout(startBeatLoop, AUDIO_OFFSET_MS);
      gameTimersRef.current.push(timerId);
    } else {
      startBeatLoop();
    }
  };

  const analyzeGame = async (
    seq: number[],
    frames: string[],
    localResults: (boolean | null)[]
  ) => {
    setStatus(GameStatus.ANALYZING);
    // playTrack('score'); // Handled by useEffect monitoring status
    setRobotState("analyzing");

    // Calculate local score for fallback
    const localCorrectCount = localResults.filter((r) => r === true).length;
    const localScore = Math.round((localCorrectCount / seq.length) * 100);

    // If LOCAL mode is selected, skip AI analysis and show results immediately
    if (judgementMode === "LOCAL") {
      setRobotState(localScore > 60 ? "happy" : "sad");
      setResultData({
        success: localScore > 60,
        correct_count: localCorrectCount,
        score: localScore,
        feedback: "Local Tracking complete. Ultra-fast feedback active!",
        detailed_results: localResults.map((r) => r === true),
        detected_counts: new Array(frames.length).fill(0), // Placeholder for UI
      });
      setStatus(GameStatus.RESULT);
      return;
    }

    try {
      // Reuse persistent AI instance
      const ai = getAI(process.env.API_KEY || "");

      // Prepare image parts
      const imageParts = frames.map((dataUrl) => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: dataUrl.split(",")[1],
        },
      }));

      const prompt = `
                You are a judge for a rhythm game.
                The player had to show a specific number of fingers for each beat.
                Target Sequence: [${seq.join(", ")}].
                I have provided ${frames.length} images.
                CRITICAL: For each beat in the target sequence, there are 3 snapshots (Before, During, and After).
                Total beats: ${seq.length}. Total images: ${frames.length}.
                
                YOUR TASK:
                1. For each beat, evaluate the 3 snapshots provided.
                2. If AT LEAST ONE of the 3 images in the group correctly shows the target number of fingers, count that beat as a SUCCESS.
                3. Be strict but fair - if the player was caught transitioning (flickering), but managed to show the correct number in at least one snapshot, give them the point.
                
                Return JSON:
                {
                    "success": boolean (true if > 60% correct),
                    "correct_count": number,
                    "score": number (0-100),
                    "feedback": "Short witty comment (max 10 words)",
                    "detailed_results": [boolean array matching sequence length],
                    "detected_counts": [number array matching EVERY INDIVIDUAL frame provided]
                }
            `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [{ text: prompt }, ...imageParts],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      });

      const responseText = response.text;
      if (!responseText) throw new Error("Empty response from AI");

      const data: GeminiResponse = JSON.parse(responseText);

      setResultData(data);
      setRobotState(data.success ? "happy" : "sad");
      setStatus(GameStatus.RESULT);
    } catch (error) {
      console.error("Gemini Analysis Failed", error);
      // Fallback to local results if API fails
      setRobotState(localScore > 60 ? "happy" : "sad");
      setResultData({
        success: localScore > 60,
        correct_count: localCorrectCount,
        score: localScore,
        feedback: "AI Offline. Using local judgment.",
        detailed_results: localResults.map((r) => r === true),
        detected_counts: seq.map(() => 0), // Placeholder
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
        // style={{ opacity: 0.01 }}
        playsInline
        muted
        autoPlay
      />

      {/* SKELETON OVERLAY */}
      <WebcamPreview
        videoRef={videoRef}
        landmarksRef={landmarksRef}
        isCameraReady={isCameraReady}
        showFingerVector={showFingerVector}
      />

      {/* Overlay Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#050510] via-transparent to-[#050510]/80 pointer-events-none" />

      {/* Top Controls */}
      <div className="absolute top-4 right-4 md:top-6 md:right-6 z-50 flex gap-2 md:gap-3">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-3 bg-white/10 rounded-full hover:bg-white/20 active:bg-white/30 transition-all pointer-events-auto touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <Settings size={20} className="md:w-6 md:h-6" />
        </button>
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-3 bg-white/10 rounded-full hover:bg-white/20 active:bg-white/30 transition-all pointer-events-auto touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          {isMuted ? (
            <VolumeX size={20} className="md:w-6 md:h-6" />
          ) : (
            <Volume2 size={20} className="md:w-6 md:h-6" />
          )}
        </button>
      </div>

      {/* DETECTED NUMBER - TOP CENTER */}
      {isCameraReady &&
        status !== GameStatus.RESULT &&
        status !== GameStatus.LOADING && (
          <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none">
            <div className="text-[14px] md:text-[18px] text-white font-bold mb-0.5 md:mb-1 drop-shadow-[0_2px_2px_rgba(0,0,0,1)] text-center w-max">
              Only 1% people can do this...
            </div>
            <div className="text-6xl md:text-9xl font-black text-white drop-shadow-[0_4px_4px_rgba(0,0,0,1)]">
              {fingerCount}
            </div>
          </div>
        )}

      {/* Main Content Container */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-3 md:p-4">
        {/* --- LOADING STATE (Entry Screen) --- */}
        {status === GameStatus.LOADING && (
          <div className="glass-panel p-6 md:p-8 rounded-3xl max-w-md w-full mx-4 flex flex-col gap-5 md:gap-6 animate-pop">
            {/* Title */}
            <div className="text-center">
              <h1 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] to-[#ff00ff] mb-1 md:mb-2">
                RHYTHM HANDS
              </h1>
              <p className="text-white/60 text-xs md:text-sm">
                {isAssetsReady ? "System Ready." : "Loading assets..."}
              </p>
            </div>

            {/* Enter Button */}
            <button
              onClick={handleEnterStudio}
              disabled={!isAssetsReady}
              className={`
                w-full py-4 rounded-xl text-lg font-black uppercase tracking-widest transition-all
                ${
                  isAssetsReady
                    ? "bg-white text-black hover:bg-gray-200 active:scale-95"
                    : "bg-white/10 text-white/30 cursor-not-allowed"
                }
              `}
            >
              {isAssetsReady ? "ENTER" : "LOADING..."}
            </button>
          </div>
        )}

        {/* --- MENU STATE --- */}
        {status === GameStatus.MENU && (
          <div className="flex flex-col items-center gap-4 md:gap-8 animate-pop w-full max-w-sm md:max-w-none">
            {!isCameraReady ? (
              <div className="text-yellow-400 animate-pulse text-xs md:text-sm">
                Initializing Camera...
              </div>
            ) : (
              <button
                onClick={() => {
                  setDifficulty("EASY");
                  startGame("EASY");
                }}
                className="group relative px-12 py-5 rounded-full bg-white text-black font-black text-2xl tracking-widest active:scale-95 transition-transform shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
              >
                START
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
                <span className="text-[10px] md:text-xs font-bold tracking-wider md:tracking-widest">
                  LIVE FEED
                </span>
              </div>
            </div>

            {/* Center Stage - Countdown Above, Glass Bar Below */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center w-full z-40 pointer-events-none">
              {/* Countdown - Massive and centered */}
              {countdown !== null && (
                <div className="text-[12rem] md:text-[20rem] font-black text-white drop-shadow-[0_10px_10px_rgba(0,0,0,1)] animate-pulse z-50">
                  {countdown}
                </div>
              )}

              {/* Active Sequence - Simple Text Overlay */}
              {status === GameStatus.PLAYING && (
                <div className="flex flex-col items-center select-none animate-pop mt-20 md:mt-32">
                  <div className="flex items-center justify-center font-black text-4xl md:text-7xl text-white drop-shadow-[0_4px_4px_rgba(0,0,0,1)] bg-black/20 px-6 py-2 rounded-lg backdrop-blur-sm">
                    {sequence.map((num, idx) => {
                      const isCurrent = idx === currentBeat;
                      const result = localResults[idx];

                      let displayClass = "transition-all duration-150";
                      if (isCurrent) {
                        displayClass += " text-white scale-125 mx-2";
                      } else if (result === true) {
                        displayClass += " text-green-400 opacity-60";
                      } else if (result === false) {
                        displayClass += " text-red-500 opacity-60";
                      } else {
                        displayClass += " text-white opacity-40";
                      }

                      return (
                        <React.Fragment key={idx}>
                          {idx > 0 && (
                            <span className="mx-0.5 opacity-30 text-white">
                              -
                            </span>
                          )}
                          <span className={displayClass}>{num}</span>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Robot Analysis */}
              {status === GameStatus.ANALYZING && (
                <div className="flex flex-col items-center gap-4 md:gap-6 animate-pop px-4">
                  <Robot state="analyzing" />
                  <h2 className="text-2xl md:text-4xl font-black uppercase text-glow animate-pulse">
                    ANALYZING...
                  </h2>
                  <p className="text-white/60 text-xs md:text-sm text-center">
                    The AI Judge is watching your moves
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- RESULT STATE --- */}
        {status === GameStatus.RESULT && resultData && (
          <div
            className="flex flex-col items-center gap-4 md:gap-6 w-full max-w-4xl animate-pop px-3 md:px-4 overflow-y-auto pb-4"
            style={{
              paddingBottom: 98,
            }}
          >
            <Robot state={robotState} />

            <h1
              className={`text-5xl md:text-7xl lg:text-9xl font-black ${
                resultData.success
                  ? "text-[#00f3ff] text-glow"
                  : "text-[#ff00ff] text-glow-pink"
              } animate-pop`}
            >
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
                    ? "border-[#00f3ff] bg-[#00f3ff]/20 shadow-[0_0_10px_#00f3ff] md:shadow-[0_0_15px_#00f3ff]"
                    : "border-[#ff00ff] bg-[#ff00ff]/10";
                  const textClass = isHit ? "text-[#00f3ff]" : "text-[#ff00ff]";
                  const label = isHit ? "HIT" : "MISS";

                  return (
                    <div
                      key={idx}
                      className={`w-12 h-16 md:w-16 md:h-24 border-2 ${colorClass} rounded-lg md:rounded-xl flex flex-col items-center justify-center backdrop-blur-sm transform transition-all active:scale-95 md:hover:scale-110`}
                    >
                      <span
                        className={`text-2xl md:text-4xl font-black ${textClass} mb-0.5 md:mb-1`}
                      >
                        {target}
                      </span>
                      <span
                        className={`text-[9px] md:text-xs uppercase font-black tracking-wider ${textClass}`}
                      >
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
              <div className="flex gap-2 md:gap-4 justify-center flex-wrap mt-3 md:mt-4">
                {sequence.map((targetCount, beatIdx) => {
                  const startIndex = beatIdx * 3;
                  const indices = [startIndex, startIndex + 1, startIndex + 2];

                  // Pick the first correct match, or fallback to the middle frame
                  let displayIdx = indices.find(
                    (idx) => resultData.detected_counts[idx] === targetCount
                  );
                  if (displayIdx === undefined) displayIdx = startIndex + 1;

                  const frame = capturedFrames[displayIdx];
                  const detected =
                    resultData.detected_counts[displayIdx] ?? "?";
                  const isCorrectMatch = detected === targetCount;
                  const isHit = resultData.detailed_results[beatIdx];

                  let borderColor = isHit
                    ? "border-[#00f3ff] shadow-[0_0_10px_#00f3ff]"
                    : "border-[#ff00ff]/50";

                  const badgeColor = isCorrectMatch
                    ? "bg-[#00f3ff]"
                    : "bg-[#ff00ff]";

                  return (
                    <div
                      key={beatIdx}
                      className={`relative w-24 h-32 md:w-32 md:h-44 rounded-lg md:rounded-xl overflow-hidden border-2 transition-all ${borderColor} bg-black/50 active:scale-110 md:hover:scale-110 origin-bottom duration-300 group touch-manipulation`}
                    >
                      <img
                        src={frame}
                        alt={`beat ${beatIdx + 1}`}
                        className="w-full h-full object-cover opacity-90 group-hover:opacity-100"
                      />
                      <div className="absolute top-1 right-1 bg-black/40 backdrop-blur-sm rounded text-[8px] md:text-[10px] text-white/50 px-1.5 py-0.5 font-mono border border-white/10">
                        BEAT {beatIdx + 1}
                      </div>
                      <div
                        className={`absolute bottom-0 w-full ${badgeColor} py-1 flex flex-col items-center shadow-[0_-2px_10px_rgba(0,0,0,0.3)]`}
                      >
                        <span className="text-[10px] md:text-xs font-black text-white uppercase tracking-tighter">
                          TAR: {targetCount}
                        </span>
                        <span className="text-[8px] md:text-[10px] font-bold text-white/90 uppercase tracking-wider">
                          SAW: {detected}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap justify-center gap-6 md:gap-8 mt-3 md:mt-4">
              <button
                onClick={() => {
                  const diffs = Object.keys(DIFFICULTIES) as Difficulty[];
                  const currentIndex = diffs.indexOf(difficulty);
                  const nextDifficulty = diffs[currentIndex + 1];

                  if (nextDifficulty) {
                    setDifficulty(nextDifficulty);
                    startGame(nextDifficulty);
                  } else {
                    // Reset to beginning when finished
                    setDifficulty("EASY");
                    setStatus(GameStatus.MENU);
                  }
                }}
                className="px-12 py-5 bg-white text-black font-black uppercase tracking-widest text-xl hover:scale-105 transition-transform shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
              >
                {difficulty === "NIGHTMARE" ? "FINISH" : "NEXT ROUND"}
              </button>
              <button
                onClick={() => startGame()}
                className="text-white/40 text-[11px] md:text-xs font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] active:text-white md:hover:text-white transition-colors border-b border-white/0 active:border-white/50 md:hover:border-white/50 pb-1 min-h-[44px] touch-manipulation"
              >
                Try Again
              </button>
              <button
                onClick={() => {
                  setDifficulty("EASY");
                  setStatus(GameStatus.MENU);
                }}
                className="text-white/40 text-[11px] md:text-xs font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] active:text-white md:hover:text-white transition-colors border-b border-white/0 active:border-white/50 md:hover:border-white/50 pb-1 min-h-[44px] touch-manipulation"
              >
                Back to Menu
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        showFingerVector={showFingerVector}
        setShowFingerVector={setShowFingerVector}
        judgementMode={judgementMode}
        setJudgementMode={setJudgementMode}
      />
    </div>
  );
};

export default App;
