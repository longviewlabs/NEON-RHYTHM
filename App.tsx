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

  // AI Results Refs (for logic and polling)
  const aiResultsRef = useRef<(boolean | null)[]>([]);
  const aiDetectedCountsRef = useRef<number[][]>([]);

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
  const [videoOpacity, setVideoOpacity] = useState(0.2);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Loading State
  const [isAssetsReady, setIsAssetsReady] = useState(false);

  // Real-time Results
  const [localResults, setLocalResults] = useState<(boolean | null)[]>([]);

  // Analysis Results (Gemini)
  const [robotState, setRobotState] = useState<RobotState>("average");
  const [resultData, setResultData] = useState<GeminiResponse | null>(null);
  const [aiResults, setAiResults] = useState<(boolean | null)[]>([]);
  const [aiDetectedCounts, setAiDetectedCounts] = useState<number[][]>([]);

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
    setAiResults([]);
    setAiDetectedCounts([]);
    aiResultsRef.current = [];
    aiDetectedCountsRef.current = [];
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
    const initialResults = new Array(newSequence.length).fill(null);
    setAiResults(initialResults);
    setAiDetectedCounts(new Array(newSequence.length).fill([]));
    aiResultsRef.current = initialResults;
    aiDetectedCountsRef.current = new Array(newSequence.length).fill([]);
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
      // Create groups to store frames chronologically for each beat
      const beatFrameGroups: (string | null)[][] = Array.from(
        { length: seq.length },
        () => [null, null, null]
      );

      // Snapshot offsets per beat: 500ms before, 0ms (on the beat), 500ms after
      const snapshotOffsets = [-500, 0, 500];

      // Schedule ALL snapshots for the entire sequence immediately
      seq.forEach((target, beatIdx) => {
        const beatMoment = beatIdx * interval;

        snapshotOffsets.forEach((offsetMs, snapshotIdx) => {
          const delay = beatMoment + offsetMs;

          // Capture frame at the precise moment (using setTimeout from loop start)
          const timerId = setTimeout(() => {
            const frame =
              videoRef.current && canvasRef.current
                ? (() => {
                    const canvas = canvasRef.current;
                    const video = videoRef.current;
                    const ctx = canvas.getContext("2d");
                    if (ctx) {
                      ctx.drawImage(video, 0, 0, 320, 240);
                      return canvas.toDataURL("image/jpeg", 0.5);
                    }
                    return null;
                  })()
                : null;

            if (frame) {
              beatFrameGroups[beatIdx][snapshotIdx] = frame;

              // If this specific beat group is now complete, send to AI
              if (
                beatFrameGroups[beatIdx].every((f) => f !== null) &&
                judgementMode === "AI"
              ) {
                analyzeBeat(
                  beatIdx,
                  beatFrameGroups[beatIdx] as string[],
                  target
                );
              }
            }
          }, Math.max(0, delay));
          gameTimersRef.current.push(timerId);
        });
      });

      // Show first beat immediately
      setCurrentBeat(0);

      const loopId = setInterval(() => {
        // JUDGE THE PREVIOUS BEAT (Local fallback logic)
        if (beat >= 0 && beat < seq.length) {
          const isHit = hasHitCurrentBeatRef.current;
          results[beat] = isHit;
          setLocalResults([...results]);

          if (isHit) playSuccessSound();
          else playFailSound();
        }

        beat++;
        hasHitCurrentBeatRef.current = false;

        if (beat >= seq.length) {
          clearInterval(loopId);
          setCurrentBeat(-1); // Remove active highlight so last beat result color shows
          // Wait for the absolute last +500ms snapshot plus a tiny safety margin
          const finishTimer = setTimeout(() => {
            const flattened = beatFrameGroups
              .flat()
              .filter((f) => f !== null) as string[];
            setCapturedFrames(flattened);
            analyzeGame(seq, results);
          }, 600);
          gameTimersRef.current.push(finishTimer);
          return;
        }

        setCurrentBeat(beat);
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

  const analyzeBeat = async (
    beatIdx: number,
    frames: string[],
    target: number
  ) => {
    try {
      const ai = getAI(process.env.API_KEY || "");
      const imageParts = frames.map((dataUrl) => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: dataUrl.split(",")[1],
        },
      }));

      const prompt = `
        Analyze these 3 snaps of a player's hand. 
        Target number of fingers: ${target}.
        Return JSON format: { "success": boolean, "detected_count": number[] }
        The 'detected_count' array must have exactly 3 numbers representing what you saw in each snapshot.
      `;

      console.log(`🤖 AI Sending Beat ${beatIdx} (Target: ${target})...`);
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }, ...imageParts] }],
        config: { responseMimeType: "application/json" },
      });

      const data = JSON.parse(response.text);
      console.log(`✅ AI Received Beat ${beatIdx}:`, data);

      // Ensure counts are numbers and derive success manually for 100% consistency
      const detectedCounts = (data.detected_count || []).map(
        (v: any) => parseInt(v) || 0
      );
      const isSuccess = detectedCounts.some((c: number) => c === target);

      // Update Ref for logic
      aiResultsRef.current[beatIdx] = isSuccess;
      aiDetectedCountsRef.current[beatIdx] = detectedCounts;

      // Update State for UI
      setAiResults([...aiResultsRef.current]);
      setAiDetectedCounts([...aiDetectedCountsRef.current]);
    } catch (e) {
      console.error(`AI Beat ${beatIdx} failed:`, e);
      // Fail silently, analyzeGame will use local fallback for missing results
    }
  };

  const analyzeGame = async (
    seq: number[],
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
        detected_counts: new Array(seq.length * 3).fill(0), // Placeholder for UI
      });
      setStatus(GameStatus.RESULT);
      return;
    }

    try {
      // 1. Wait for AT LEAST ONE AI result to finish before showing result screen
      // This makes the transition feel instant
      let attempts = 0;
      let hasOneResult = false;

      while (attempts < 40) {
        const currentCount = aiResultsRef.current.filter(
          (r) => r !== null
        ).length;

        if (currentCount > 0 && !hasOneResult) {
          hasOneResult = true;
          setStatus(GameStatus.RESULT);
        }

        // If all are done, finish pooling
        if (currentCount >= seq.length) break;

        await new Promise((r) => setTimeout(r, 250));
        attempts++;
      }

      // 2. Aggregate final data from REF once all is settled (or timeout)
      const finalAiResults = aiResultsRef.current.slice(0, seq.length);
      const correct_count = finalAiResults.filter((r) => r === true).length;
      const score = Math.round((correct_count / seq.length) * 100);

      setResultData({
        success: score > 60,
        correct_count,
        score,
        feedback:
          score > 80 ? "Perfect rhythm!" : "AI verified your performance.",
        detailed_results: finalAiResults.map((r) => r === true),
        detected_counts: aiDetectedCountsRef.current.flat(),
      });
      setRobotState(score > 60 ? "happy" : "sad");
    } catch (error) {
      console.error("Gemini Analysis Failed or Timeout", error);
      // Fallback to local results
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
        className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
        style={{
          opacity: window.location.hostname === "localhost" ? 0 : videoOpacity,
        }}
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

      {/* Minimal Overlay Shadow (Top only for visibility) */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent pointer-events-none" />

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
          <>
            <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none w-full">
              {/* <div className="text-[20px] md:text-[32px] text-white font-black mb-2 drop-shadow-[0_2px_2px_rgba(0,0,0,1)] text-center px-6 leading-tight">
                Only 1% people can do this...
              </div> */}
            </div>

            <div className="absolute top-4 left-4 z-50 pointer-events-none">
              <div className="text-xl md:text-3xl font-black text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)] opacity-80">
                {fingerCount}
              </div>
            </div>
          </>
        )}

      {/* Main Content Container */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-3 md:p-4">
        {/* --- LOADING STATE (Entry Screen) --- */}
        {status === GameStatus.LOADING && (
          <div className="bg-black/80 p-8 rounded-3xl max-w-md w-full mx-4 flex flex-col gap-6 animate-pop border border-white/20">
            {/* Title */}
            <div className="text-center">
              <h1 className="text-4xl font-black text-white mb-2 tracking-tighter shadow-sm">
                NEON RHYTHM
              </h1>
              <p className="text-white/40 text-sm font-bold uppercase tracking-widest">
                {isAssetsReady ? "SYSTEM READY" : "LOADING ASSETS..."}
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
            {/* Simple Status (Optional) */}
            <div className="absolute top-4 right-20 md:right-24">
              <div className="px-3 py-1 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                <span className="text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
                  REC
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

              {/* Active Sequence - Simple Text Overlay (Matches Reference Image) */}
              {status === GameStatus.PLAYING && (
                <div className="flex flex-col items-center select-none animate-pop w-full px-4">
                  <div className="flex flex-wrap justify-center items-center font-bold text-4xl md:text-6xl lg:text-7xl text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)]">
                    {sequence.map((num, idx) => {
                      const isCurrent = idx === currentBeat;
                      const result = localResults[idx];

                      let displayClass = "transition-all duration-100";
                      if (isCurrent) {
                        displayClass += " text-white scale-110";
                      } else if (result === true) {
                        displayClass += " text-green-500 opacity-90";
                      } else if (result === false) {
                        displayClass += " text-red-500 opacity-90";
                      } else {
                        displayClass += " text-white opacity-80";
                      }

                      return (
                        <React.Fragment key={idx}>
                          {idx > 0 && (
                            <span className="mx-0.5 opacity-60">-</span>
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
        {status === GameStatus.RESULT && (
          <div
            className="flex flex-col items-center gap-4 md:gap-6 w-full max-w-4xl animate-pop px-3 md:px-4 overflow-y-auto pb-4"
            style={{
              paddingBottom: 98,
            }}
          >
            <Robot state={robotState} />

            {(() => {
              const currentCorrect = aiResults.filter((r) => r === true).length;
              const isFinished =
                aiResults.filter((r) => r === null).length === 0;

              return (
                <h1
                  className={`text-6xl md:text-8xl font-black text-white drop-shadow-[0_4px_4px_rgba(0,0,0,1)] ${
                    !isFinished ? "animate-pulse" : ""
                  }`}
                >
                  {currentCorrect} / {sequence.length}
                </h1>
              );
            })()}

            {/* Detailed Results Panel */}
            <div className="bg-black/60 p-6 rounded-3xl border border-white/10 w-full backdrop-blur-md">
              <div className="text-center text-xs font-black text-white/40 mb-6 tracking-[0.3em] uppercase">
                PERFORMANCE LOG
              </div>

              {/* Grid of Results */}
              <div className="flex gap-1.5 md:gap-2 mb-4 md:mb-6 justify-center flex-wrap">
                {sequence.map((target, idx) => {
                  const aiRes = aiResults[idx];
                  const isPending = aiRes === null;

                  const colorClass = isPending
                    ? "border-white/20 bg-white/5 animate-pulse"
                    : aiRes === true
                    ? "border-green-500 bg-green-500/20"
                    : "border-red-500 bg-red-500/20";

                  const textClass = isPending
                    ? "text-white/20"
                    : aiRes === true
                    ? "text-green-500"
                    : "text-red-500";

                  const label = isPending
                    ? "..."
                    : aiRes === true
                    ? "HIT"
                    : "MISS";

                  return (
                    <div
                      key={idx}
                      className={`w-14 h-20 md:w-16 md:h-24 border-2 ${colorClass} rounded-lg flex flex-col items-center justify-center transition-all`}
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
                {resultData
                  ? `"${resultData.feedback}"`
                  : "Calculating final judgment..."}
              </div>

              {/* Captured Frames Grid */}
              <div className="flex gap-2 md:gap-4 justify-center flex-wrap mt-3 md:mt-4">
                {sequence.map((targetCount, beatIdx) => {
                  const aiRes = aiResults[beatIdx];
                  const isPending = aiRes === null;

                  // Get detected counts for this beat group
                  const beatDetected = aiDetectedCounts[beatIdx] || [];
                  const startIndex = beatIdx * 3;

                  // Logic to pick a frame to show
                  let displayFrameIdx = 1; // Default to middle
                  let detectedVal: string | number = "?";

                  if (!isPending) {
                    // If we have AI results, try to find a matching frame
                    const matchIdx = beatDetected.findIndex(
                      (c) => c === targetCount
                    );
                    displayFrameIdx = matchIdx !== -1 ? matchIdx : 1;
                    detectedVal = beatDetected[displayFrameIdx];
                  }

                  const frame = capturedFrames[startIndex + displayFrameIdx];
                  const colorClass = isPending
                    ? "border-white/10"
                    : aiRes === true
                    ? "border-green-500"
                    : "border-red-500";

                  const badgeColor = isPending
                    ? "bg-white/10"
                    : aiRes === true
                    ? "bg-green-600"
                    : "bg-red-600";

                  return (
                    <div
                      key={beatIdx}
                      className={`relative w-24 h-32 md:w-32 md:h-44 rounded-lg md:rounded-xl overflow-hidden border-2 transition-all ${colorClass} bg-black/50 active:scale-110 md:hover:scale-110 origin-bottom duration-300 group touch-manipulation`}
                    >
                      <img
                        src={frame}
                        alt={`beat ${beatIdx + 1}`}
                        className={`w-full h-full object-cover transition-opacity ${
                          isPending ? "opacity-30 blur-[2px]" : "opacity-90"
                        } group-hover:opacity-100`}
                      />
                      <div className="absolute top-1 right-1 bg-black/40 backdrop-blur-sm rounded text-[8px] md:text-[10px] text-white/50 px-1.5 py-0.5 font-mono border border-white/10">
                        {isPending ? "JUDGING..." : `BEAT ${beatIdx + 1}`}
                      </div>
                      <div
                        className={`absolute bottom-0 w-full ${badgeColor} py-1 flex flex-col items-center shadow-[0_-2px_10_rgba(0,0,0,0.3)] transition-colors`}
                      >
                        <span className="text-[10px] md:text-xs font-black text-white uppercase tracking-tighter">
                          TAR: {targetCount}
                        </span>
                        <span className="text-[8px] md:text-[10px] font-bold text-white/90 uppercase tracking-wider">
                          SAW: {isPending ? "?" : detectedVal}
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
        videoOpacity={videoOpacity}
        setVideoOpacity={setVideoOpacity}
      />
    </div>
  );
};

export default App;
