/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useMediaPipe } from "./hooks/useMediaPipe";
import Robot from "./components/Robot";
import WebcamPreview from "./components/WebcamPreview";
import FingerCountDisplay from "./components/FingerCountDisplay";
import SequenceDisplay from "./components/SequenceDisplay";
import SettingsModal from "./components/SettingsModal";
import StartScreen from "./components/StartScreen";
import { useVideoRecorder } from "./hooks/useVideoRecorder";
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
  WIN_SOUND_URL,
  LOSE_SOUND_URL,
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
  const winBufferRef = useRef<AudioBuffer | null>(null);
  const loseBufferRef = useRef<AudioBuffer | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentGainRef = useRef<GainNode | null>(null);

  // Memory & Timer Management
  const gameTimersRef = useRef<(number | NodeJS.Timeout)[]>([]);
  const gameIdRef = useRef(0);

  // Tracking
  const { isCameraReady, fingerCount, landmarksRef } = useMediaPipe(videoRef);
  const { startRecording, stopRecording, videoBlob, isRecording, setOverlayText } = useVideoRecorder(videoRef);

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
  const [scoringEngine, setScoringEngine] = useState<"local" | "ai">("local");
  const [capturedFrames, setCapturedFrames] = useState<string[]>([]);
  const [judgementMode, setJudgementMode] = useState<"LOCAL" | "AI">("LOCAL");
  const [isMuted, setIsMuted] = useState(false);
  const [videoOpacity, setVideoOpacity] = useState(1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Loading State
  const [isAssetsReady, setIsAssetsReady] = useState(false);

  // Real-time Results
  const [localResults, setLocalResults] = useState<(boolean | null)[]>([]);

  // Infinite Mode State
  const [isInfiniteMode, setIsInfiniteMode] = useState(true);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentBpm, setCurrentBpm] = useState(105);
  const [currentLength, setCurrentLength] = useState(8);

  // Analysis Results (Gemini)
  const [robotState, setRobotState] = useState<RobotState>("average");
  const [resultData, setResultData] = useState<GeminiResponse | null>(null);
  const [aiResults, setAiResults] = useState<(boolean | null)[]>([]);
  const [aiDetectedCounts, setAiDetectedCounts] = useState<number[][]>([]);
  const [revealedResults, setRevealedResults] = useState<(boolean | null)[]>(
    []
  );

  // --- AUDIO HELPERS ---
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

  // Success: Pleasant major chord chime (nice sounding ding)
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

      gain.gain.setValueAtTime(0.3, now); // Boosted for clarity
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25 + i * 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(now + 0.4);

      // Cleanup
      setTimeout(() => {
        osc.disconnect();
        gain.disconnect();
      }, 500);
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
    osc.frequency.linearRampToValueAtTime(50, now + 0.4);

    gain.gain.setValueAtTime(0.4, now); // Significantly boosted for "Real-time Fail" feel
    gain.gain.linearRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(now + 0.4);

    // Cleanup
    setTimeout(() => {
      osc.disconnect();
      gain.disconnect();
    }, 400);
  }, [isMuted]);

  // One-shot audio player for win/lose effects (not looped, not stopping bg music)
  const playOneShot = useCallback(
    (type: "win" | "lose") => {
      const ctx = audioCtxRef.current;
      if (!ctx || isMuted) return;

      const buffer =
        type === "win" ? winBufferRef.current : loseBufferRef.current;
      if (!buffer) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gain = ctx.createGain();
      gain.gain.value = 0.5;

      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);

      // Cleanup
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
    },
    [isMuted]
  );

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
    setRevealedResults([]);
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

  // Handle Score Screen Reveal Logic and Sounds
  useEffect(() => {
    if (status === GameStatus.RESULT) {
      // Initialize revealedResults to the correct length filled with null
      // Use functional update to ensure we are working with the latest state if needed,
      // though here we just want to reset it for the new result screen.
      setRevealedResults(new Array(sequence.length).fill(null));

      if (judgementMode === "LOCAL") {
        // LOCAL MODE: Reveal one by one with a delay
        let i = 0;
        const interval = setInterval(() => {
          if (i < sequence.length) {
            // FIX: Ensure we use the most recent value from the ref, fallback to false if still null/undefined
            const res = aiResultsRef.current[i] ?? false;
            setRevealedResults((prev) => {
              const next = [...prev];
              if (i < next.length) {
                next[i] = res;
              }
              return next;
            });
            if (res === true) playSuccessSound();
            else if (res === false) playFailSound();
            i++;

            if (i === sequence.length) {
              const totalCorrect = aiResultsRef.current
                .slice(0, sequence.length)
                .filter((r) => r === true).length;
              const isPerfect = totalCorrect === sequence.length;
              setTimeout(() => {
                playOneShot(isPerfect ? "win" : "lose");
                setRobotState(isPerfect ? "happy" : "sad");
              }, 500);
            }
          } else {
            clearInterval(interval);
          }
        }, 300);
        gameTimersRef.current.push(interval);
        return () => clearInterval(interval);
      } else {
        // AI MODE: Sync revealedResults with aiResults as they come
        // We use a staggered reveal for already available results, 
        // and then the next effect handles ones that arrive late.
        const initialResults = [...aiResults];
        let i = 0;
        const interval = setInterval(() => {
          if (i < sequence.length) {
            // Check live ref instead of initial snapshot
            const currentResult = aiResultsRef.current[i];
            if (currentResult !== null) {
              const res = currentResult;
              setRevealedResults((prev) => {
                const next = [...prev];
                next[i] = res;
                return next;
              });
              if (res === true) playSuccessSound();
              else if (res === false) playFailSound();
              i++;
            }
          } else {
            clearInterval(interval);
            // Check if all were revealed already and play sound/set state
            setRevealedResults((prev) => {
              if (prev.every((r) => r !== null)) {
                const totalCorrect = prev.filter((r) => r === true).length;
                const isPerfect = totalCorrect === sequence.length;

                // Update Overlay for final frame
                setOverlayText(`ROUND ${currentRound} COMPLETE\\nSCORE: ${totalCorrect}/${sequence.length}`);

                setTimeout(() => {
                  playOneShot(isPerfect ? "win" : "lose");
                  setRobotState(isPerfect ? "happy" : "sad");

                  // Stop recording shortly after result is shown to capture the reaction
                  setTimeout(() => {
                    stopRecording();
                  }, 4000);
                }, 500);
              }
              return prev;
            });
          }
        }, 75);
        gameTimersRef.current.push(interval);
        return () => clearInterval(interval);
      }
    } else {
      // When not in RESULT state, keep revealedResults empty or reset
      // This prevents the previous game's results from flickering
      setRevealedResults(new Array(sequence.length).fill(null));
    }
  }, [
    status,
    judgementMode,
    sequence.length,
    playSuccessSound,
    playFailSound,
    aiResults, // Added aiResults to dependency to ensure the initialResults snapshot is fresh
  ]);


  // Generate random sequence based on difficulty or infinite stats
  const generateSequence = useCallback(
    (diff: Difficulty, lengthOverride?: number) => {
      const config = DIFFICULTIES[diff];
      const length = lengthOverride || config.length;

      const newSequence: number[] = [];
      for (let i = 0; i < length; i++) {
        let nextNum;
        do {
          nextNum = Math.floor(Math.random() * 6); // 0-5
        } while (i > 0 && nextNum === newSequence[i - 1]);
        newSequence.push(nextNum);
      }
      return newSequence;
    },
    []
  );

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
      const [intro, game, score, win, lose] = await Promise.all([
        introBufferRef.current
          ? Promise.resolve(introBufferRef.current)
          : loadAudioBuffer(MUSIC_INTRO_URL, ctx),
        gameBufferRef.current
          ? Promise.resolve(gameBufferRef.current)
          : loadAudioBuffer(MUSIC_GAME_URL, ctx),
        scoreBufferRef.current
          ? Promise.resolve(scoreBufferRef.current)
          : loadAudioBuffer(MUSIC_SCORE_URL, ctx),
        winBufferRef.current
          ? Promise.resolve(winBufferRef.current)
          : loadAudioBuffer(WIN_SOUND_URL, ctx),
        loseBufferRef.current
          ? Promise.resolve(loseBufferRef.current)
          : loadAudioBuffer(LOSE_SOUND_URL, ctx),
      ]);

      introBufferRef.current = intro;
      gameBufferRef.current = game;
      scoreBufferRef.current = score;
      winBufferRef.current = win || null;
      loseBufferRef.current = lose || null;
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
        } catch (e) { }
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
          const targetBPM = isInfiniteMode
            ? currentBpm
            : DIFFICULTIES[difficulty].bpm;
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
      } catch (e) { }
      currentSourceRef.current = null;
    }
    currentGainRef.current = null;
  }, []);

  // Effect to switch music based on state (except Playing, which is handled in startGame)
  useEffect(() => {
    if (!audioCtxRef.current) return;

    // Removed GameStatus.MENU auto-play to prevent redundant triggers
    // we now trigger it manually in handleStartGame and startGame
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

  // Handle "Enter Studio" button click
  const handleEnterStudio = useCallback(async () => {
    if (!isAssetsReady) return;

    // 1. Resume Context immediately on user click
    const ctx = audioCtxRef.current;
    if (ctx && (ctx.state === "suspended" || ctx.state === "interrupted")) {
      await ctx.resume();
    }

    // 2. Start game directly
    startGame();
  }, [isAssetsReady]); // 'startGame' omitted from deps to avoid circular if not hoisted

  // Effect to switch music based on state
  useEffect(() => {
    if (!audioCtxRef.current) return;

    if (status === GameStatus.RESULT || status === GameStatus.ANALYZING) {
      playTrack("score");
    }
  }, [status, playTrack]);

  // --- GAME LOOP ---
  const startGame = async (
    forcedDifficulty?: Difficulty,
    bpmOverride?: number,
    lengthOverride?: number
  ) => {
    gameIdRef.current += 1; // Increment session ID
    const currentSessionId = gameIdRef.current;
    
    cleanupTempData(); // Clear memory/timers from previous rounds

    const targetDifficulty = forcedDifficulty || difficulty;
    const length =
      lengthOverride ||
      (isInfiniteMode ? currentLength : DIFFICULTIES[targetDifficulty].length);
    const newSequence = generateSequence(targetDifficulty, length);
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

    // Start Video Recording
    startRecording();
    setOverlayText(`ROUND ${isInfiniteMode ? currentRound : "?"} | ${targetDifficulty}`);
    const targetBPM =
      bpmOverride ||
      (isInfiniteMode ? currentBpm : DIFFICULTIES[targetDifficulty].bpm);
    const playbackRate = targetBPM / BASE_BPM;

    // Time until first beat at current playback rate
    const timeToFirstBeat = FIRST_BEAT_TIME_SEC / playbackRate;

    const countdownDuration = 3; // 3 seconds countdown

    if (timeToFirstBeat >= countdownDuration) {
      // First beat comes after countdown - start music now, it will sync
      playTrack("game", 0);

      // Wait for the difference, then start countdown
      const waitTime = (timeToFirstBeat - countdownDuration) * 1000;
      const timerId = setTimeout(() => {
        startCountdown(newSequence, currentSessionId);
      }, waitTime);
      gameTimersRef.current.push(timerId);
    } else {
      // First beat comes before countdown ends - skip intro
      // Start music from a point so first beat aligns with countdown end
      const skipAmount = FIRST_BEAT_TIME_SEC; // Skip the intro
      playTrack("game", skipAmount);

      // Start countdown immediately
      startCountdown(newSequence, currentSessionId);
    }
  };

  // Handle "Start Game" button click (merged from handleEnterStudio)
  const handleStartGame = useCallback(async () => {
    if (!isAssetsReady) return;

    // 1. Resume Context immediately on user click
    const ctx = audioCtxRef.current;
    if (ctx && (ctx.state === "suspended" || ctx.state === "interrupted")) {
      await ctx.resume();
    }

    // 2. Start game directly, bypassing MENU state
    setIsInfiniteMode(true);
    setCurrentRound(1);
    setCurrentBpm(105);
    setCurrentLength(8);
    startGame(undefined, 105, 8);
  }, [isAssetsReady, startGame]);

  // Separated countdown logic for cleaner code
  const startCountdown = (newSequence: number[], currentSessionId: number) => {
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
        runSequence(newSequence, currentSessionId);
      }
    }, 1000);
    gameTimersRef.current.push(timerId);
  };

  const runSequence = (seq: number[], currentSessionId: number) => {
    // playMusic(); // Removed: Handled in startGame now
    const bpm = isInfiniteMode ? currentBpm : DIFFICULTIES[difficulty].bpm;
    const interval = 60000 / bpm;
    let beat = 0; // Start at 0
    const frames: string[] = [];
    const results: (boolean | null)[] = new Array(seq.length).fill(null);

    // Pre-set canvas size for optimized capture (Low res is enough for AI)
    if (canvasRef.current) {
      canvasRef.current.width = 160;
      canvasRef.current.height = 120;
    }

    // Start the beat loop after audio offset for perfect sync
    const startBeatLoop = () => {
      // Create groups to store frames and local counts chronologically for each beat
      const beatFrameGroups: (string | null)[][] = Array.from(
        { length: seq.length },
        () => [null, null, null]
      );
      const beatLocalCounts: (number | null)[][] = Array.from(
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
            const currentLocalCount = fingerCountRef.current;
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
              beatLocalCounts[beatIdx][snapshotIdx] = currentLocalCount;

              // If this specific beat group is now complete
              if (beatFrameGroups[beatIdx].every((f) => f !== null)) {
                if (judgementMode === "AI") {
                  analyzeBeat(
                    beatIdx,
                    beatFrameGroups[beatIdx] as string[],
                    target,
                    currentSessionId
                  );
                } else {
                  // LOCAL mode: Populate detection counts from MediaPipe
                  const localCounts = beatLocalCounts[beatIdx] as number[];
                  aiDetectedCountsRef.current[beatIdx] = localCounts;
                  setAiDetectedCounts([...aiDetectedCountsRef.current]);
                }
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

          // In LOCAL mode, we still want to show results on the final screen
          if (judgementMode === "LOCAL") {
            aiResultsRef.current[beat] = isHit;
            setAiResults([...aiResultsRef.current]);
          }

          if (!isHit) playFailSound();
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
            analyzeGame(seq, results, currentSessionId);
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
    target: number,
    sessionId: number
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
        Target number of fingers: ${target} (Note: 0 means a closed fist or no fingers extended).
        Return JSON format: { "success": boolean, "detected_count": number[] }
        The 'detected_count' array must have exactly 3 numbers representing what you saw in each snapshot.
      `;

      console.log(`🤖 AI Sending Beat ${beatIdx} (Target: ${target})...`);
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }, ...imageParts] }],
        config: { responseMimeType: "application/json" },
      });

      // Session Check: If game was reset/next round while AI was thinking, ignore this result
      if (sessionId !== gameIdRef.current) {
        console.log(`⚠️ AI Result for Beat ${beatIdx} discarded (Old Session)`);
        return;
      }

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

      if (!isSuccess) playFailSound();
    } catch (e) {
      console.error(`AI Beat ${beatIdx} failed:`, e);
      // Fail silently, analyzeGame will use local fallback for missing results
    }
  };

  const analyzeGame = async (
    seq: number[],
    localResults: (boolean | null)[],
    sessionId: number
  ) => {
    setStatus(GameStatus.ANALYZING);
    // playTrack('score'); // Handled by useEffect monitoring status
    setRobotState("analyzing");

    // Calculate local score for fallback
    const localCorrectCount = localResults.filter((r) => r === true).length;
    const localScore = Math.round((localCorrectCount / seq.length) * 100);

    // If LOCAL mode is selected, skip AI analysis and show results immediately
    // If LOCAL mode is selected, show results immediately
    if (judgementMode === "LOCAL") {
      const isPerfect = localScore === 100;
      const syncResults = localResults.map((r) => r === true);

      setRobotState("average");
      setResultData({
        success: isPerfect,
        correct_count: localCorrectCount,
        score: localScore,
        feedback: "Local Tracking complete. Ultra-fast feedback active!",
        detailed_results: syncResults,
        detected_counts: aiDetectedCountsRef.current.flat(),
      });

      // Sync results immediately
      aiResultsRef.current = syncResults;
      setAiResults(syncResults);

      // Move to result screen
      setStatus(GameStatus.RESULT);
      return;
    }

    // AI Mode
    try {
      // 1. Wait for AT LEAST ONE AI result to finish before showing result screen
      let attempts = 0;
      const maxAttempts = 20; // ~5 seconds max wait for the FIRST result
      let hasOneResult = false;

      while (attempts < 30) {
        const currentCount = aiResultsRef.current.filter(
          (r) => r !== null
        ).length;

        if (currentCount > 0 && !hasOneResult) {
          hasOneResult = true;
          setStatus(GameStatus.RESULT);
        }

        if (currentCount >= seq.length) break;
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }

      // Session Check
      if (sessionId !== gameIdRef.current) return;

      // 2. Fill any missing AI results with local judgments (Failover)
      const finalAiResults = [...aiResultsRef.current].slice(0, seq.length);
      const syncedResults: boolean[] = finalAiResults.map((r, i) => {
        if (r !== null) return r;
        return localResults[i] === true; // local fallback
      });

      const correct_count = syncedResults.filter((r) => r === true).length;
      const score = Math.round((correct_count / seq.length) * 100);
      const isPerfect = score === 100;

      setResultData({
        success: isPerfect,
        correct_count,
        score,
        feedback: isPerfect
          ? "Perfect rhythm!"
          : "AI verified your performance.",
        detailed_results: syncedResults,
        detected_counts: aiDetectedCountsRef.current.flat(),
      });

      // Crucial: Update aiResults state so the reveal loop can finish
      setAiResults(syncedResults);
      aiResultsRef.current = syncedResults;

      setRobotState("average");
      setStatus(GameStatus.RESULT);
    } catch (error) {
      console.error("Gemini Analysis Failed or Timeout", error);
      const isPerfect = localScore === 100;
      setRobotState(isPerfect ? "happy" : "sad");
      setResultData({
        success: isPerfect,
        correct_count: localCorrectCount,
        score: localScore,
        feedback: "AI Offline. Using local judgment.",
        detailed_results: localResults.map((r) => r === true),
        detected_counts: aiDetectedCountsRef.current.flat(),
      });
      setAiResults(localResults.map((r) => r === true));
      setStatus(GameStatus.RESULT);
    }
  };

  // --- RENDER ---
  const currentBpmForCalc = isInfiniteMode
    ? currentBpm
    : DIFFICULTIES[difficulty].bpm;
  const beatDuration = 60 / currentBpmForCalc; // in seconds

  return (
    <div className="relative w-full h-screen bg-[#050510] overflow-hidden text-white font-sans selection:bg-[#ff00ff]">
      {/* Hidden Canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Background Video */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain scale-x-[-1]"
        style={
          {
            //   opacity: window.location.hostname === "localhost" ? 1 : videoOpacity,
          }
        }
        playsInline
        muted
        autoPlay
      />

      {/* SKELETON OVERLAY */}
      <WebcamPreview
        videoRef={videoRef}
        landmarksRef={landmarksRef}
        isCameraReady={isCameraReady}
        showFingerVector={
          status === GameStatus.LOADING || status === GameStatus.RESULT
        }
      />

      {/* Minimal Overlay Shadow (Top only for visibility) */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/40 to-transparent pointer-events-none z-10" />


      {/* Main Content Container */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-3 md:p-4">
        {/* --- LOADING STATE (Viral Challenge Entry Screen) --- */}
        {status === GameStatus.LOADING && (
          <StartScreen 
            onStart={handleStartGame} 
            isAssetsReady={isAssetsReady} 
          />
        )}

        {/* --- MENU STATE --- */}
        {status === GameStatus.MENU && (
          <div className="flex flex-col items-center gap-4 md:gap-8 animate-pop w-full max-w-sm md:max-w-none">
            {!isCameraReady ? (
              <div className="text-yellow-400 animate-pulse text-xs md:text-sm">
                Initializing Camera...
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center text-center">
                  {/* <h2 className="text-xl md:text-2xl font-black text-white/60 tracking-widest uppercase mb-1">
                    Mode
                  </h2>  */}
                  {/* <div className="text-3xl md:text-4xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                    FINGER RHYTHM
                  </div> */}
                </div>

                <button
                  onClick={() => {
                    setCurrentRound(1);
                    setCurrentBpm(105);
                    setCurrentLength(8);
                    startGame(undefined, 105, 8);
                  }}
                  className="group relative px-12 py-5 rounded-full bg-white text-black font-black text-2xl tracking-widest active:scale-95 transition-transform shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
                >
                  START INFINITE
                </button>
              </div>
            )}
          </div>
        )}

        {/* --- PLAYING / ANALYZING STATE --- */}
        {(status === GameStatus.PLAYING || status === GameStatus.ANALYZING) && (
          <div className="w-full h-full flex flex-col justify-between py-6 md:py-12">
            {/* Top Center Round Info */}
            <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none w-full opacity-50">
              <div className="text-4xl md:text-6xl font-black text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)] uppercase tracking-tighter animate-pop">
                ROUND {currentRound}
              </div>
              <div className="flex items-center gap-3 mt-1.5 px-3 py-1 bg-black/40 backdrop-blur-md rounded-full border border-white/10 shadow-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                <span className="text-[10px] md:text-xs font-black text-white/70 uppercase tracking-[0.2em]">
                  {currentBpm} BPM | {sequence.length} BEATS
                </span>
              </div>
            </div>

            {/* Top Center Countdown */}
            {countdown !== null && (
              <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                <div className="text-9xl md:text-[12rem] font-black text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.8)] animate-pulse">
                  {countdown}
                </div>
              </div>
            )}

            {/* Center Stage - Glass Bar Below */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center w-full z-40 pointer-events-none">
              {/* Active Sequence */}
              {status === GameStatus.PLAYING && (
                <div
                  className={`flex flex-col items-center select-none animate-pop w-full px-4 transition-opacity duration-500 ${countdown !== null ? "opacity-20" : "opacity-100"
                    }`}
                >
                  <div
                    className={`flex flex-col items-center gap-2 md:gap-4 transition-all duration-500`}
                  >
                    {(() => {
                      const isLong = sequence.length > 12;
                      const midPoint = isLong
                        ? Math.ceil(sequence.length / 2)
                        : sequence.length;

                      const renderRow = (nums: number[], startIdx: number) => (
                        <div className="flex flex-wrap justify-center items-center font-bold text-4xl md:text-6xl lg:text-7xl text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)] gap-0">
                          {nums.map((num, i) => {
                            const globalIdx = i + startIdx;
                            const isCurrent = globalIdx === currentBeat;

                            let displayClass =
                              "transition-all duration-300 ease-out inline-block";
                            if (isCurrent && countdown === null) {
                              displayClass +=
                                " text-yellow-400 scale-[1.6] drop-shadow-[0_0_30px_rgba(250,204,21,0.6)] z-10 font-black";
                            } else {
                              displayClass += " text-white opacity-100";
                            }

                            return (
                              <React.Fragment key={globalIdx}>
                                {i > 0 && (
                                  <span className="mx-0.5 opacity-80">-</span>
                                )}
                                <span className={displayClass}>{num}</span>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      );

                      return (
                        <>
                          {renderRow(sequence.slice(0, midPoint), 0)}
                          {isLong &&
                            renderRow(sequence.slice(midPoint), midPoint)}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Robot Analysis */}
              {status === GameStatus.ANALYZING && (
                <div className="flex flex-col items-center gap-4 md:gap-6 animate-pop px-4">
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

        {status === GameStatus.RESULT && (
          <div
            className="flex flex-col items-center gap-4 md:gap-6 w-full max-w-4xl animate-pop px-3 md:px-4 overflow-y-auto no-scrollbar pb-4 max-h-full relative"
            style={{
              paddingBottom: 98,
            }}
          >
            {(() => {
              const currentCorrect = revealedResults.filter(
                (r) => r === true
              ).length;
              const isFinished =
                revealedResults.length > 0 &&
                revealedResults.every((r) => r !== null);

              if (!isFinished) return null;

              return (
                <div className="flex flex-col items-center animate-slide-up-pop">
                  <Robot state={robotState} />
                  <div className="mt-8 mb-4 relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                    <div className="relative px-8 py-4 bg-black/50 backdrop-blur-xl rounded-lg border border-white/20 shadow-2xl flex items-center gap-4">
                      <span className="text-3xl md:text-5xl font-black italic text-transparent bg-clip-text bg-gradient-to-r from-blue-100 to-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] uppercase tracking-tighter">
                        ROUND {currentRound}
                      </span>
                      <span className="text-xl md:text-3xl font-bold text-white/90 uppercase tracking-[0.2em] border-l-2 border-white/30 pl-4">
                        COMPLETE
                      </span>
                    </div>
                  </div>
                  <h1 className="text-6xl md:text-8xl font-black text-white drop-shadow-[0_4px_4px_rgba(0,0,0,1)]">
                    {currentCorrect} / {sequence.length}
                  </h1>
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div className="flex flex-col items-center gap-4 md:gap-5 mt-3 md:mt-4">
              {(() => {
                const currentCorrect = revealedResults.filter(
                  (r) => r === true
                ).length;
                const isFinished =
                  revealedResults.length > 0 &&
                  revealedResults.every((r) => r != null);
                const isPerfect =
                  isFinished && currentCorrect === sequence.length;
                const isDev = window.location.hostname === "localhost";

                if (!isFinished) {
                  return (
                    <button
                      disabled
                      className="px-12 py-5 bg-white/10 text-white/40 font-black uppercase tracking-widest text-xl cursor-not-allowed opacity-50 border border-white/10 rounded-lg"
                    >
                      Analyzing...
                    </button>
                  );
                }

                if (isFinished && !isPerfect) {
                  return (
                    <div className="flex flex-col items-center gap-4 w-full">
                      <button
                        onClick={() => startGame()}
                        className="animate-slide-up-pop px-12 py-5 bg-red-600 text-white font-black uppercase tracking-widest text-xl hover:bg-red-700 active:scale-95 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.5)] rounded-2xl w-full min-w-[280px]"
                      >
                        TRY AGAIN
                      </button>
                    </div>
                  );
                }

                if (isFinished && isPerfect) {
                  return (
                    <div className="flex flex-col items-center gap-4 w-full">
                      {isInfiniteMode ? (
                        <button
                          onClick={() => {
                            const nextBpm = currentBpm + 5;
                            const nextLength = currentLength + 3;
                            setCurrentBpm(nextBpm);
                            setCurrentLength(nextLength);
                            setCurrentRound((r) => r + 1);
                            startGame(undefined, nextBpm, nextLength);
                          }}
                          className="px-12 py-5 bg-green-600 text-white font-black uppercase tracking-widest text-xl hover:bg-green-700 hover:scale-105 active:scale-95 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.5)] rounded-2xl w-full min-w-[280px]"
                        >
                          NEXT ROUND
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            const diffs = Object.keys(
                              DIFFICULTIES
                            ) as Difficulty[];
                            const currentIndex = diffs.indexOf(difficulty);
                            const nextDifficulty = diffs[currentIndex + 1];

                            if (nextDifficulty) {
                              setDifficulty(nextDifficulty);
                              startGame(nextDifficulty);
                            } else {
                              setDifficulty("EASY");
                              setStatus(GameStatus.LOADING);
                            }
                          }}
                          className="px-12 py-5 bg-green-600 text-white font-black uppercase tracking-widest text-xl hover:bg-green-700 hover:scale-105 active:scale-95 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.5)] rounded-2xl w-full min-w-[280px]"
                        >
                          {difficulty === "NIGHTMARE" ? "FINISH" : "NEXT ROUND"}
                        </button>
                      )}
                      <button
                        onClick={() => startGame()}
                        className="text-white text-[11px] md:text-xs font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] opacity-60 hover:opacity-100 transition-opacity underline underline-offset-8"
                      >
                        Replay Level
                      </button>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Share / Save Video Button */}
              {videoBlob && (
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(videoBlob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `neon-rhythm-round-${currentRound}.mp4`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="mt-6 px-8 py-3 bg-blue-600 text-white font-black uppercase tracking-widest text-sm md:text-base hover:bg-blue-700 hover:scale-105 transition-all shadow-lg rounded-full flex items-center gap-2"
                >
                  <span>DOWNLOAD REPLAY</span>
                  <span className="text-xl">📹</span>
                </button>
              )}

              <button
                onClick={() => {
                  setDifficulty("EASY");
                  setIsInfiniteMode(true);
                  setCurrentRound(1);
                  setCurrentBpm(105);
                  setCurrentLength(8);
                  setStatus(GameStatus.LOADING);
                }}
                className="text-white/40 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] hover:text-white transition-colors mt-4"
              >
                Back to Menu
              </button>
            </div>

            {/* Detailed Results Panel */}
            <div className="bg-black/60 p-6 rounded-3xl border border-white/10 w-full backdrop-blur-md">

              {/* Results Sequence Overlay (Colored based on results) */}
              <div className="flex flex-wrap justify-center items-center font-bold text-4xl md:text-6xl lg:text-7xl text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)] gap-0 mb-8 md:mb-12">
                {sequence.map((num, i) => {
                  const res = revealedResults[i];
                  const isMiss = res === false;
                  const isPending = res === null;

                  let colorClass = "text-white";
                  if (!isPending) {
                    if (isMiss) colorClass = "text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.4)]";
                    else colorClass = "text-white"; // Hits remain white as requested
                  }

                  return (
                    <React.Fragment key={i}>
                      {i > 0 && (
                        <span className="mx-0.5 opacity-80 text-white">-</span>
                      )}
                      <span className={`transition-all duration-300 ${colorClass}`}>
                        {num}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Captured Frames Grid */}
              <div className="flex gap-2 md:gap-4 justify-center flex-wrap mt-3 md:mt-4">
                {sequence.map((targetCount, beatIdx) => {
                  const res = revealedResults[beatIdx];
                  const isPending = res == null;

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
                    : res === true
                      ? "border-green-500"
                      : "border-red-500";

                  const badgeColor = isPending
                    ? "bg-white/10"
                    : res === true
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
                        className={`w-full h-full object-cover transition-opacity ${isPending ? "opacity-30 blur-[2px]" : "opacity-90"
                          } group-hover:opacity-100`}
                      />
                      <div className="absolute top-1 right-1 bg-black/40 backdrop-blur-sm rounded text-[8px] md:text-[10px] text-white/50 px-1.5 py-0.5 font-mono border border-white/10">
                        {isPending ? "JUDGING..." : `BEAT ${beatIdx + 1}`}
                      </div>
                      <div
                        className={`absolute bottom-0 w-full ${badgeColor} py-1 flex flex-col items-center shadow-[0_-2px_10_rgba(0,0,0,0.3)] transition-colors`}
                      >

                        <span className="text-[8px] md:text-[10px] font-bold text-white/90 uppercase tracking-wider">
                          SAW: {isPending ? "?" : detectedVal}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
    </div>
  );
};

export default App;
