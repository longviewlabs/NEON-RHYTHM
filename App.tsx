/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useMediaPipe } from "./hooks/useMediaPipe";
import Robot from "./components/Robot";
import WebcamPreview from "./components/WebcamPreview";

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
import { useRhythmEngine, MusicType, PATTERNS } from "./hooks/useRhythmEngine";
import {
  MUSIC_INTRO_URL,
  // MUSIC_GAME_URL, // Removed
  WIN_SOUND_URL,
  LOSE_SOUND_URL,
  BASE_BPM,
  AUDIO_OFFSET_MS,
  FIRST_BEAT_TIME_SEC,
} from "./constants";
import ShareInstructionsModal from "./components/ShareInstructionsModal";
import { shareVideo, saveVideo, ShareTarget } from "./utils/shareUtils";
import { Download } from "lucide-react";
import SafeZone from "./components/SafeZone";

// Initialize AI outside component to avoid re-instantiation memory overhead
let genAIInstance: GoogleGenAI | null = null;
const getAI = (apiKey: string) => {
  if (!genAIInstance) genAIInstance = new GoogleGenAI({ apiKey });
  return genAIInstance;
};

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const App: React.FC = () => {
  // Hardware Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(
    null
  );
  const recorderGainRef = useRef<GainNode | null>(null);

  // Difficulty Tracking Refs (to avoid stale closures)
  const infiniteBpmRef = useRef(100);
  const infiniteLengthRef = useRef(8);
  const currentRoundRef = useRef(1);

  // Audio Buffers & Source
  const introBufferRef = useRef<AudioBuffer | null>(null);
  const gameBufferRef = useRef<AudioBuffer | null>(null);
  const winBufferRef = useRef<AudioBuffer | null>(null);
  const loseBufferRef = useRef<AudioBuffer | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentGainRef = useRef<GainNode | null>(null);

  // Memory & Timer Management
  const gameTimersRef = useRef<(number | NodeJS.Timeout)[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const gameIdRef = useRef(0);
  const sessionIdRef = useRef(0);
  const stopRecordingTimeoutRef = useRef<number | null>(null);

  // Tracking
  const [status, setStatus] = useState<GameStatus>(GameStatus.LOADING);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [sequence, setSequence] = useState<number[]>([]);

  const statusRef = useRef<GameStatus>(GameStatus.LOADING);
  const currentBeatRef = useRef(-1);
  const sequenceRef = useRef<number[]>([]);
  const fingerCountRef = useRef(0);

  // Sync refs with state
  useEffect(() => {
    statusRef.current = status;
    currentBeatRef.current = currentBeat;
    sequenceRef.current = sequence;
  }, [status, currentBeat, sequence]);

  const handleFingerCountUpdate = useCallback((count: number) => {
    fingerCountRef.current = count;

    if (
      statusRef.current === GameStatus.PLAYING &&
      currentBeatRef.current >= 0 &&
      currentBeatRef.current < sequenceRef.current.length
    ) {
      const target = sequenceRef.current[currentBeatRef.current];
      if (count === target && !hitBeatsRef.current[currentBeatRef.current]) {
        console.log(`[HIT-DIRECT] count=${count} matches target=${target}`);
        hitBeatsRef.current[currentBeatRef.current] = true;
      }
    }
  }, []);

  const { isCameraReady, landmarksRef } = useMediaPipe(
    videoRef,
    handleFingerCountUpdate
  );
  const rhythmEngine = useRhythmEngine(
    audioCtxRef.current,
    recorderGainRef.current
  );

  // Track Rotation State (Simplified to one track)
  const currentPattern: MusicType = "happy_hardcore";

  // Ref to track if target was hit for each beat index (prevents race conditions)
  const hitBeatsRef = useRef<boolean[]>([]);

  // AI Results Refs (for logic and polling)
  const aiResultsRef = useRef<(boolean | null)[]>([]);
  const aiDetectedCountsRef = useRef<number[][]>([]);

  // Game State
  const [difficulty, setDifficulty] = useState<Difficulty>("EASY");
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
  const [displayRound, setDisplayRound] = useState(1);
  const [exitingRound, setExitingRound] = useState<number | null>(null);
  const [currentBpm, setCurrentBpm] = useState(95);
  const [currentLength, setCurrentLength] = useState(8);

  // Video overlay state - only updates when new sequence is generated
  const [videoOverlayRound, setVideoOverlayRound] = useState(1);
  const [videoOverlayBpm, setVideoOverlayBpm] = useState(95);

  // Video Recorder Hook (uses separate overlay state that only updates with new sequence)
  const {
    startRecording,
    stopRecording,
    videoBlob,
    isRecording,
    setOverlayText,
    setFailOverlay,
  } = useVideoRecorder(
    videoRef,
    audioStreamDestRef.current?.stream,
    videoOverlayRound,
    videoOverlayBpm
  );

  // Analysis Results (Gemini)
  const [robotState, setRobotState] = useState<RobotState>("average");
  const [showFlash, setShowFlash] = useState(false);
  const [resultData, setResultData] = useState<GeminiResponse | null>(null);
  const [aiResults, setAiResults] = useState<(boolean | null)[]>([]);
  const [aiDetectedCounts, setAiDetectedCounts] = useState<number[][]>([]);
  const [revealedResults, setRevealedResults] = useState<(boolean | null)[]>(
    []
  );

  // Sharing State
  const [activeShareTarget, setActiveShareTarget] =
    useState<ShareTarget | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isVideoDownloaded, setIsVideoDownloaded] = useState(false);
  const [showSaveToast, setShowSaveToast] = useState(false);

  // Sync Video Recorder Overlay with Game State
  useEffect(() => {
    if (!isRecording) return;

    if (status === GameStatus.PLAYING) {
      if (countdown !== null) {
        setOverlayText(`COUNTDOWN:${countdown}`);
      } else {
        // Create a string like "1 2 [[3]] 4 5" to show progress in the video
        const displaySeq = sequence
          .map((num, i) => (i === currentBeat ? `[[${num}]]` : num))
          .join(" ");
        setOverlayText(`ROUND ${videoOverlayRound}\\n${displaySeq}`);
      }
    } else if (status === GameStatus.ANALYZING) {
      // Keep showing the final sequence at the end instead of "ANALYZING..."
      const displaySeq = sequence.join(" ");
      setOverlayText(`ROUND ${videoOverlayRound}\\n${displaySeq}`);
    }
  }, [
    status,
    currentBeat,
    sequence,
    videoOverlayRound,
    isRecording,
    setOverlayText,
    countdown,
  ]);

  // Stop recording ONLY when the game is over (user loses) or back to menu
  useEffect(() => {
    const currentCorrect = revealedResults.filter((r) => r === true).length;
    const isFinished =
      (revealedResults.length > 0 && revealedResults.every((r) => r != null)) ||
      (isInfiniteMode && revealedResults.some((r) => r === false));
    const isPerfect = isFinished && currentCorrect === sequence.length;
    const isGameOver = isFinished && !isPerfect;

    // Stop recording on Game Over (with 5s delay to capture fail reaction) or if we return to the main loading/start screen
    const shouldStopImmediately = status === GameStatus.LOADING && isRecording;

    const shouldStopWithDelay =
      status === GameStatus.RESULT && isGameOver && isRecording;

    if (shouldStopImmediately) {
      // Clear any pending timeout
      if (stopRecordingTimeoutRef.current !== null) {
        clearTimeout(stopRecordingTimeoutRef.current);
        stopRecordingTimeoutRef.current = null;
      }
      stopRecording();
    } else if (shouldStopWithDelay) {
      // Clear any existing timeout first
      if (stopRecordingTimeoutRef.current !== null) {
        clearTimeout(stopRecordingTimeoutRef.current);
      }

      // Delay 3 seconds to capture user's fail reaction
      const timeoutId = setTimeout(() => {
        stopRecording();
        stopRecordingTimeoutRef.current = null;
      }, 3000);

      stopRecordingTimeoutRef.current = timeoutId as any;

      return () => {
        clearTimeout(timeoutId);
        if (stopRecordingTimeoutRef.current === (timeoutId as any)) {
          stopRecordingTimeoutRef.current = null;
        }
      };
    }
  }, [
    status,
    isRecording,
    stopRecording,
    revealedResults,
    sequence.length,
    isInfiniteMode,
  ]);

  // Handle Round Transition Animation State
  useEffect(() => {
    if (currentRound !== displayRound) {
      setExitingRound(displayRound);
      setDisplayRound(currentRound);
      const timer = setTimeout(() => setExitingRound(null), 600);
      return () => clearTimeout(timer);
    }
  }, [currentRound, displayRound]);

  // --- AUDIO HELPERS ---
  // Countdown beep: Matches index copy.html (always plays, not affected by mute)
  const playCountdownBeep = useCallback((count: number) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    // Connect to BOTH hardware output and recording stream
    gain.connect(ctx.destination);
    if (recorderGainRef.current) gain.connect(recorderGainRef.current);

    osc.frequency.value = 400 + count * 100; // Pitch shift based on count
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
    if (recorderGainRef.current) envelope.connect(recorderGainRef.current);

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
      if (recorderGainRef.current) gain.connect(recorderGainRef.current);
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
    if (recorderGainRef.current) gain.connect(recorderGainRef.current);
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
      if (recorderGainRef.current) gain.connect(recorderGainRef.current);
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
    // 1. Clear standard timers
    gameTimersRef.current.forEach((id) => {
      if (id) {
        clearInterval(id as any);
        clearTimeout(id as any);
      }
    });
    gameTimersRef.current = [];

    // 2. Kill the high-frequency game loop (CPU fix)
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Reset heavy state
    setCapturedFrames([]);
    setLocalResults([]);
    setAiResults([]);
    setRevealedResults([]);
    setAiDetectedCounts([]);
    aiResultsRef.current = [];
    aiDetectedCountsRef.current = [];
    setCurrentBeat(-1);
    hitBeatsRef.current = [];
  }, []);

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
            // CRITICAL: Capture current index in a const BEFORE the async setState
            const currentIndex = i;
            const res = aiResultsRef.current[currentIndex] ?? false;
            setRevealedResults((prev) => {
              const next = [...prev];
              if (currentIndex < next.length) {
                next[currentIndex] = res; // Use currentIndex, NOT i
              }
              return next;
            });

            // SILENCE SOUNDS IN INFINITE MODE (already handled in runSequence)
            if (!isInfiniteMode) {
              if (res === true) playSuccessSound();
              else if (res === false) playFailSound();
            }

            i++;

            if (i === sequence.length) {
              const totalCorrect = aiResultsRef.current
                .slice(0, sequence.length)
                .filter((r) => r === true).length;
              const isPerfect = totalCorrect === sequence.length;

              // SILENCE FINAL SOUNDS IN INFINITE MODE
              if (!isInfiniteMode) {
                setTimeout(() => {
                  playOneShot(isPerfect ? "win" : "lose");
                  setRobotState(isPerfect ? "happy" : "sad");
                }, 500);
              }
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

              // SILENCE SOUNDS IN INFINITE MODE
              if (!isInfiniteMode) {
                if (res === true) playSuccessSound();
                else if (res === false) playFailSound();
              }

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
                const statusText = isPerfect ? "COMPLETE" : "FAIL";
                setOverlayText(
                  `ROUND ${currentRound} ${statusText}\\nSCORE: ${totalCorrect}/${sequence.length}`
                );

                // Note: Fail overlay is set in runSequence when user actually fails during gameplay
                // No need to set it here in result screen logic

                // SILENCE FINAL SOUNDS IN INFINITE MODE
                if (!isInfiniteMode) {
                  setTimeout(() => {
                    playOneShot(isPerfect ? "win" : "lose");
                    setRobotState(isPerfect ? "happy" : "sad");
                  }, 500);
                }
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
        let isInvalid = false;
        do {
          nextNum = Math.floor(Math.random() * 5) + 1; // 1-5 (removed 0)
          isInvalid = false;

          // Rule 1: No immediate duplicates
          if (i > 0 && nextNum === newSequence[i - 1]) {
            isInvalid = true;
          }

          // Rule 2: No 3 consecutive numbers (1-2-3)
          if (i >= 2) {
            const prev1 = newSequence[i - 1];
            const prev2 = newSequence[i - 2];
            // Check Ascending (1-2-3)
            if (prev2 === prev1 - 1 && prev1 === nextNum - 1) {
              isInvalid = true;
            }
          }
        } while (isInvalid);
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
          const ctx = new AudioContextClass();
          audioCtxRef.current = ctx;

          // Initialize Recording Destination
          const dest = ctx.createMediaStreamDestination();
          audioStreamDestRef.current = dest;

          const recorderGain = ctx.createGain();
          recorderGain.gain.value = 1.0;
          recorderGainRef.current = recorderGain;
          recorderGain.connect(dest);
        }
      }

      const ctx = audioCtxRef.current;
      if (!ctx) return;

      // Load tracks in parallel (game music is now programmatic)
      const [intro, win, lose] = await Promise.all([
        introBufferRef.current
          ? Promise.resolve(introBufferRef.current)
          : loadAudioBuffer(MUSIC_INTRO_URL, ctx),
        winBufferRef.current
          ? Promise.resolve(winBufferRef.current)
          : loadAudioBuffer(WIN_SOUND_URL, ctx),
        loseBufferRef.current
          ? Promise.resolve(loseBufferRef.current)
          : loadAudioBuffer(LOSE_SOUND_URL, ctx),
      ]);

      introBufferRef.current = intro;
      // gameBufferRef.current = game; // No longer used
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
  // startTime: absolute AudioContext time to start playback (scheduling)
  const playTrack = useCallback(
    (type: "intro" | "game", startOffset: number = 0, startTime?: number) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return 0;

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
          // Programmatic music engine used instead of MP3
          return 0;
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

        // If no startTime provided, start after a tiny buffer for stability
        const actualStartTime = startTime || ctx.currentTime + 0.05;
        source.start(actualStartTime, offset);

        currentSourceRef.current = source;
        currentGainRef.current = gain;

        return actualStartTime;
      }
      return 0;
    },
    [isMuted, difficulty, isInfiniteMode, currentBpm]
  );

  const stopMusic = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {}
      currentSourceRef.current = null;
    }
    currentGainRef.current = null;
    rhythmEngine.stop();
  }, [rhythmEngine]);

  // Effect to switch music based on state (except Playing, which is handled in startGame)
  useEffect(() => {
    if (!audioCtxRef.current) return;

    // Stop current track (Score music track no longer exists)

    if (status === GameStatus.RESULT || status === GameStatus.ANALYZING) {
      stopMusic();
    }
  }, [status, playTrack, stopMusic, isInfiniteMode]);

  // Update volume of currently playing music when mute state changes
  useEffect(() => {
    if (!currentGainRef.current || !audioCtxRef.current) return;

    const gain = currentGainRef.current;
    const ctx = audioCtxRef.current;

    // Determine the target volume based on current track type
    let targetVolume = 0.5;
    if (status === GameStatus.MENU && introBufferRef.current) {
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

  // --- GAME LOOP ---
  const startGame = async (
    forcedDifficulty?: Difficulty,
    bpmOverride?: number,
    lengthOverride?: number
  ) => {
    gameIdRef.current += 1; // Increment session ID
    const currentSessionId = gameIdRef.current;
    sessionIdRef.current = currentSessionId;

    cleanupTempData(); // Clear memory/timers from previous rounds

    // Clear fail overlay at the start of each game/round
    setFailOverlay({ show: false, round: currentRoundRef.current });

    const targetDifficulty = forcedDifficulty || difficulty;
    const length =
      lengthOverride ||
      (isInfiniteMode
        ? infiniteLengthRef.current
        : DIFFICULTIES[targetDifficulty].length);
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
    hitBeatsRef.current = new Array(newSequence.length).fill(false);

    const targetBPM =
      bpmOverride || (isInfiniteMode ? infiniteBpmRef.current : 100);

    // Update round and BPM display at the same time as new sequence
    if (isInfiniteMode) {
      setCurrentRound(currentRoundRef.current);
      setCurrentBpm(Math.round(targetBPM));
      setCurrentLength(length);
      // Update video overlay state when new sequence is ready
      setVideoOverlayRound(currentRoundRef.current);
      setVideoOverlayBpm(Math.round(targetBPM));
    }

    // Update rhythm engine BPM even if already running
    rhythmEngine.setBpm(targetBPM);

    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // CRITICAL: Always ensure context is resumed
    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume();
    }

    let firstBeatTime: number;

    if (rhythmEngine.isActive()) {
      // SEAMLESS CONTINUATION:
      // Music is already playing.
      // Find the next bar start that gives us enough time for the countdown.
      const minLeadIn = 3.5; // seconds (to cover 3s countdown + buffer)
      firstBeatTime = rhythmEngine.getNextDownbeat(minLeadIn);
    } else {
      // START TRACK (Fresh Game):
      const musicStartTime = ctx.currentTime + 0.1;
      const beatDuration = 60 / targetBPM;
      const minLeadIn = 3.5; // seconds
      const leadInBeats = Math.ceil(minLeadIn / beatDuration);
      firstBeatTime = musicStartTime + leadInBeats * beatDuration;

      rhythmEngine.start(targetBPM, "happy_hardcore", musicStartTime);

      // Only start recording if not already recording
      // This keeps the recording continuous during round transitions
      if (!isRecording) {
        startRecording();
      }
    }

    // Start countdown coordination
    startCountdown(newSequence, currentSessionId, firstBeatTime, targetBPM);
    runSequence(newSequence, currentSessionId, firstBeatTime, targetBPM);
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
    setJudgementMode("LOCAL"); // Force LOCAL mode for real-time infinite play
    setCurrentRound(1);
    currentRoundRef.current = 1;
    // Speed up initial difficulty
    infiniteBpmRef.current = 100;
    infiniteLengthRef.current = 8;

    // Update State
    setCurrentBpm(100);
    setCurrentLength(8);

    startGame(undefined, 100, 8);
  }, [isAssetsReady, startGame]);

  const handleShare = async (target: ShareTarget = "system") => {
    if (!videoBlob) return;

    console.log(`[Instrument] share_clicked target: ${target}`);
    const mimeType = videoBlob.type.split(";")[0];
    const extension = mimeType.split("/")[1] || "mp4";
    const file = new File([videoBlob], `neon-rhythm-run.${extension}`, {
      type: videoBlob.type,
    });

    if (target !== "system") {
      console.log(`[Instrument] quickshare_${target}_clicked`);
      setActiveShareTarget(target);
      setIsShareModalOpen(true);
      return;
    }

    const result = await shareVideo(file, target);
    if (result.method === "native") {
      if (result.success) {
        console.log(`[Instrument] share_native_success`);
      } else {
        console.log(
          `[Instrument] share_native_cancelled_or_failed: ${result.error}`
        );
      }
    } else {
      console.log(`[Instrument] share_fallback_trigger_modal`);
      setActiveShareTarget("system");
      setIsShareModalOpen(true);
    }
  };

  const handleSaveVideo = () => {
    if (!videoBlob) return;
    console.log(`[Instrument] save_video_clicked`);
    const mimeType = videoBlob.type.split(";")[0];
    const extension = mimeType.split("/")[1] || "mp4";
    const file = new File([videoBlob], `neon-rhythm-run.${extension}`, {
      type: videoBlob.type,
    });
    saveVideo(file);
    setIsVideoDownloaded(true);
    setShowSaveToast(true);
    setTimeout(() => setShowSaveToast(false), 3000);
    console.log(`[Instrument] save_video_success`);
  };

  // Separated countdown logic for cleaner code
  const startCountdown = (
    newSequence: number[],
    currentSessionId: number,
    firstBeatTime: number,
    bpm: number
  ) => {
    const beatDuration = 60 / bpm;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // We want 3 beeps leading up to the first beat
    // Beep 1: firstBeatTime - 3 * beatDuration
    // Beep 2: firstBeatTime - 2 * beatDuration
    // Beep 3: firstBeatTime - 1 * beatDuration
    // GO: firstBeatTime

    [3, 2, 1, 0].forEach((count) => {
      const beepTime = firstBeatTime - count * beatDuration;
      const delay = Math.max(0, (beepTime - ctx.currentTime) * 1000);

      const timerId = setTimeout(() => {
        if (sessionIdRef.current !== currentSessionId) return;

        if (count > 0) {
          setCountdown(count);
          playCountdownBeep(count);
        } else {
          setCountdown(null);
          playCountdownBeep(0);
          // REMOVED: runSequence is now called immediately in startGame
        }
      }, delay);
      gameTimersRef.current.push(timerId);
    });
  };

  const runSequence = (
    seq: number[],
    currentSessionId: number,
    firstBeatTime: number,
    bpm: number
  ) => {
    const intervalSec = 60 / bpm;

    // The FIRST beat happens at this absolute AudioContext time
    // firstBeatTime is passed in directly now

    const results: (boolean | null)[] = new Array(seq.length).fill(null);
    const beatFrameGroups: (string | null)[][] = Array.from(
      { length: seq.length },
      () => [null, null, null]
    );
    const beatLocalCounts: (number | null)[][] = Array.from(
      { length: seq.length },
      () => [null, null, null]
    );

    // Snapshot offsets per beat: -300ms, 0ms (on the beat), +300ms
    const snapshotOffsetsSec = [-0.3, 0, 0.3];

    let nextBeatToSchedule = 0;
    let nextJudgementBeat = 0;
    const LOOKAHEAD_SEC = 0.5; // Look ahead 500ms
    const SCHEDULER_INTERVAL_MS = 50;

    // Start the beat loop after audio offset for perfect sync
    const startBeatLoop = () => {
      // Pre-set canvas size for optimized capture (Low res is enough for AI)
      if (canvasRef.current) {
        canvasRef.current.width = 160;
        canvasRef.current.height = 120;
      }

      const scheduler = () => {
        const ctx = audioCtxRef.current;
        if (!ctx || sessionIdRef.current !== currentSessionId) return;

        const currentTime = ctx.currentTime;

        // 1. SCHEDULE SNAPSHOTS AND UI HIGHLIGHTS
        // Reduced lookahead to 0.3s for tighter scheduling control
        while (
          nextBeatToSchedule < seq.length &&
          firstBeatTime + nextBeatToSchedule * intervalSec < currentTime + 0.3
        ) {
          const beatIdx = nextBeatToSchedule;
          const beatTime = firstBeatTime + beatIdx * intervalSec;

          // Schedule the UI highlight for this beat
          // Tighter React buffer (15ms instead of 30ms) for better feel
          const uiDelay = Math.max(0, (beatTime - currentTime) * 1000 - 15);
          const uiTimer = setTimeout(() => {
            if (sessionIdRef.current !== currentSessionId) return;
            // console.log(
            //   `[SYNC-UI] Beat ${beatIdx}: target=${
            //     seq[beatIdx]
            //   } @ ${beatTime.toFixed(3)}s`
            // );
            setCurrentBeat(beatIdx);
          }, uiDelay);
          gameTimersRef.current.push(uiTimer);

          // Schedule snapshots
          snapshotOffsetsSec.forEach((offset, snapIdx) => {
            const snapTime = beatTime + offset;
            const snapDelay = Math.max(0, (snapTime - currentTime) * 1000);

            const snapTimer = setTimeout(() => {
              if (sessionIdRef.current !== currentSessionId) return;
              const currentLocalCount = fingerCountRef.current;
              beatLocalCounts[beatIdx][snapIdx] = currentLocalCount;

              if (judgementMode === "AI") {
                const canvas = canvasRef.current;
                const video = videoRef.current;
                const ctxCanvas = canvas?.getContext("2d", { alpha: false });
                if (ctxCanvas && video && canvas) {
                  ctxCanvas.drawImage(video, 0, 0, 160, 120);
                  const frame = canvas.toDataURL("image/jpeg", 0.3);
                  beatFrameGroups[beatIdx][snapIdx] = frame;

                  if (beatFrameGroups[beatIdx].every((f) => f !== null)) {
                    analyzeBeat(
                      beatIdx,
                      beatFrameGroups[beatIdx] as string[],
                      seq[beatIdx],
                      currentSessionId
                    );
                  }
                }
              } else {
                aiDetectedCountsRef.current[beatIdx] = beatLocalCounts[
                  beatIdx
                ] as number[];
              }
            }, snapDelay);
            gameTimersRef.current.push(snapTimer);
          });

          nextBeatToSchedule++;
        }

        // 2. JUDGE BEATS
        // Judgement happens slightly earlier (80%) to catch the pose before user transitions
        // and REPLACES 'latching' with 'holding' requirement to avoid "too forgiving" feedback.
        const judgeOffsetSec = intervalSec * 0.9;
        while (
          nextJudgementBeat < seq.length &&
          firstBeatTime + nextJudgementBeat * intervalSec + judgeOffsetSec <
            currentTime
        ) {
          const beatIdx = nextJudgementBeat;
          // MODIFIED: Use hitBeatsRef latching for much more stable detection.
          // This ensures that if the user hit the target AT ANY POINT during the beat,
          // it counts as a success, which handles MediaPipe flickering (especially for 0).
          const isHit =
            hitBeatsRef.current[beatIdx] ||
            fingerCountRef.current === seq[beatIdx];

          // console.log(
          //   `[SYNC-JUDGE] Beat ${beatIdx}: isHit=${isHit} (target ${seq[beatIdx]}, ref ${fingerCountRef.current}, latched ${hitBeatsRef.current[beatIdx]})`
          // );

          results[beatIdx] = isHit;
          setLocalResults([...results]);

          if (judgementMode === "LOCAL") {
            aiResultsRef.current[beatIdx] = isHit;
            setAiResults([...aiResultsRef.current]);
          }

          if (!isHit) {
            playFailSound();
            if (isInfiniteMode) {
              gameTimersRef.current.forEach((id) => {
                clearTimeout(id as any);
                clearInterval(id as any);
              });
              gameTimersRef.current = [];
              setRevealedResults([...results]);
              setRobotState("sad");
              playOneShot("lose");
              setShowFlash(true);
              setStatus(GameStatus.RESULT);
              setFailOverlay({ show: true, round: currentRoundRef.current });
              setTimeout(() => setShowFlash(false), 600);
              return;
            }
          }
          nextJudgementBeat++;

          if (nextJudgementBeat === seq.length) {
            setCurrentBeat(-1);
            if (isInfiniteMode) {
              playOneShot("win");
              setRobotState("happy");
              setFailOverlay({ show: false, round: currentRoundRef.current }); // Clear fail overlay on success
              setOverlayText(`ROUND ${currentRoundRef.current} CLEARED!`);
              setOverlayText(`ROUND ${currentRoundRef.current} CLEARED!`);
              const transitionTimer = setTimeout(() => {
                currentRoundRef.current += 1;
                const nextRound = currentRoundRef.current;
                const nextLength = 8 + (nextRound - 1) * 3;
                const nextBpm = 100 + (nextRound - 1) * 5;

                infiniteLengthRef.current = nextLength;
                infiniteBpmRef.current = nextBpm;

                // Update UI state immediately so TRANSITION screen shows correct values
                setCurrentRound(nextRound);
                setCurrentBpm(Math.round(nextBpm));
                setCurrentLength(nextLength);
                // Don't update video overlay state yet - wait until new sequence is generated

                // ENTER TRANSITION STATE
                setStatus(GameStatus.TRANSITION);
                rhythmEngine.setBpm(nextBpm); // Speed up music immediately

                // Hold transition for 3 seconds before starting next round (which begins with countdown)
                const startTimer = setTimeout(() => {
                  startGame(undefined, nextBpm, nextLength);
                }, 3000);
                gameTimersRef.current.push(startTimer);
              }, 1500);
              gameTimersRef.current.push(transitionTimer);
              return;
            }
            setTimeout(() => {
              const flattened = beatFrameGroups
                .flat()
                .filter((f) => f !== null) as string[];
              setCapturedFrames(flattened);
              analyzeGame(seq, results, currentSessionId);
            }, 500);
            return;
          }
        }
        // FIX: Update the dedicated ref to prevent loop stacking
        rafIdRef.current = requestAnimationFrame(scheduler);
      };
      scheduler();
    };

    // Use a ref to track current session ID for the scheduler
    startBeatLoop();

    // Cleanup: Stop music when round ends or fails
    const cleanup = () => {
      rhythmEngine.stop();
    };
    // Note: cleanup logic is often handled by status changes or timers in this app
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
        Target number of fingers: ${target}.
        Return JSON format: { "success": boolean, "detected_count": number[] }
        The 'detected_count' array must have exactly 3 numbers representing what you saw in each snapshot.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }, ...imageParts] }],
        config: { responseMimeType: "application/json" },
      });

      // Session Check: If game was reset/next round while AI was thinking, ignore this result
      if (sessionId !== gameIdRef.current) {
        return;
      }

      const data = JSON.parse(response.text);

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

      // CRITICAL: Sync detected counts state with ref before showing results
      setAiDetectedCounts([...aiDetectedCountsRef.current]);

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

      {/* FAIL FLASH OVERLAY */}
      {showFlash && <div className="fail-flash-overlay" />}

      {/* Background Video */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
        style={{
          opacity: videoOpacity,
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
        showFingerVector={
          status === GameStatus.LOADING || status === GameStatus.MENU
        }
      />

      {/* 9:16 SAFE ZONE FOR DESKTOP */}
      <SafeZone />

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
                    setCurrentBpm(95);
                    setCurrentLength(8);
                    setCurrentRound(1);
                    startGame(undefined, 95, 8);
                  }}
                  className="group relative px-12 py-5 rounded-full bg-white text-black font-black text-2xl tracking-widest active:scale-95 transition-transform shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
                >
                  START INFINITE
                </button>
              </div>
            )}
          </div>
        )}

        {/* --- PLAYING / ANALYZING / TRANSITION STATE --- */}
        {(status === GameStatus.PLAYING ||
          status === GameStatus.ANALYZING ||
          status === GameStatus.TRANSITION) && (
          <div className="w-full h-full flex flex-col justify-between py-6 md:py-12">
            {/* Top Center Round Info - Hidden during Transition as we show a bigger one */}
            {status !== GameStatus.TRANSITION && (
              <div className="absolute top-10 left-0 right-0 z-50 flex flex-col items-center pointer-events-none scale-110 md:scale-125 overflow-hidden">
                <div className="relative h-24 md:h-32 w-full flex items-center justify-center">
                  {exitingRound !== null && (
                    <div
                      key={`exit-${exitingRound}`}
                      className="absolute text-6xl md:text-8xl font-black text-white/50 drop-shadow-[0_0_30px_rgba(255,255,255,0.2)] uppercase italic tracking-tighter animate-round-slide-out leading-none"
                    >
                      ROUND {exitingRound}
                    </div>
                  )}
                  <div
                    key={`enter-${displayRound}`}
                    className="absolute text-6xl md:text-8xl font-black text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.4)] uppercase italic tracking-tighter animate-round-slide-in leading-none"
                  >
                    ROUND {displayRound}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3 px-4 py-1.5 bg-white/10 backdrop-blur-xl rounded-full border border-white/20 shadow-2xl">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
                  <span className="text-[10px] md:text-xs font-black text-white/90 uppercase tracking-[0.25em]">
                    {currentBpm} BPM
                  </span>
                </div>
              </div>
            )}

            {/* TRANSITION OVERLAY - Big Round & BPM */}
            {/* TRANSITION OVERLAY - Big Round & BPM */}
            {status === GameStatus.TRANSITION && (
              <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in-fast">
                <div className="flex flex-col items-center gap-2">
                  <div
                    className="text-4xl md:text-6xl font-black text-white/80 uppercase tracking-widest animate-slide-in-top opacity-0"
                    style={{
                      animationDelay: "0.1s",
                      animationFillMode: "forwards",
                    }}
                  >
                    NEXT UP
                  </div>
                  <div
                    className="text-6xl md:text-9xl font-black text-white drop-shadow-[0_0_50px_rgba(255,255,255,0.6)] italic tracking-tighter leading-none animate-zoom-in-pop opacity-0 px-3 whitespace-nowrap"
                    style={{
                      animationDelay: "0.3s",
                      animationFillMode: "forwards",
                    }}
                  >
                    ROUND {currentRound}
                  </div>
                  <div className="relative mt-4">
                    <div className="absolute -inset-4 bg-red-500/20 blur-xl rounded-full animate-pulse"></div>
                    <div
                      className="relative text-6xl md:text-8xl font-black text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,1)] tracking-widest animate-slide-in-bottom opacity-0"
                      style={{
                        animationDelay: "0.5s",
                        animationFillMode: "forwards",
                      }}
                    >
                      {currentBpm} BPM
                    </div>
                  </div>
                  <div
                    className="mt-8 text-xl text-white/60 font-bold tracking-[0.5em] animate-bounce animate-fade-in-delayed opacity-0"
                    style={{
                      animationDelay: "0.7s",
                      animationFillMode: "forwards",
                    }}
                  >
                    SPEED INCREASING...
                  </div>
                </div>
              </div>
            )}

            {/* Top Center Countdown */}
            {countdown !== null && (
              <div className="absolute top-[25%] left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                <div
                  key={countdown}
                  className="text-9xl md:text-[12rem] font-black text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.8)] animate-countdown-dramatic"
                >
                  {countdown}
                </div>
              </div>
            )}

            {/* Center Stage - Glass Bar Below */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center w-full z-40 pointer-events-none">
              {/* Active Sequence */}
              {(status === GameStatus.PLAYING ||
                status === GameStatus.TRANSITION) && (
                <div className="flex flex-col items-center w-full">
                  {/* MAIN SEQUENCE */}
                  <SequenceDisplay
                    sequence={sequence}
                    currentBeat={currentBeat}
                    countdown={countdown}
                  />
                </div>
              )}

              {/* Robot Analysis */}
              {status === GameStatus.ANALYZING &&
                !localResults.some((r) => r === false) && (
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
            className="flex flex-col items-center justify-center gap-2 md:gap-6 w-full max-w-4xl animate-pop px-3 md:px-4 h-full relative"
            style={{
              paddingBottom: 20,
            }}
          >
            {(() => {
              const currentCorrect = revealedResults.filter(
                (r) => r === true
              ).length;
              const isFinished =
                (revealedResults.length > 0 &&
                  revealedResults.every((r) => r != null)) ||
                (isInfiniteMode && revealedResults.some((r) => r === false));
              const isPerfect =
                isFinished && currentCorrect === sequence.length;
              const hideForInfiniteFail = isInfiniteMode && !isPerfect;

              if (!isFinished && !hideForInfiniteFail) {
                return (
                  <div className="flex flex-col items-center gap-4 md:gap-6 animate-pop px-4">
                    <h2 className="text-2xl md:text-4xl font-black uppercase text-glow animate-pulse">
                      ANALYZING...
                    </h2>
                  </div>
                );
              }

              return (
                <div className="flex flex-col items-center relative gap-2 md:gap-4">
                  {/* BIG ANIMATED FAIL TITLE AND SUBTITLE */}
                  {hideForInfiniteFail && (
                    <div className="z-[100] pointer-events-none mb-10 md:mb-20 animate-fail-stamp flex flex-col items-start translate-x-[-2%]">
                      <div className="text-[7rem] md:text-[16rem] font-black text-red-600 drop-shadow-[0_0_50px_rgba(220,38,38,0.8)] uppercase italic tracking-tighter select-none leading-none">
                        FAIL
                      </div>
                      <div className="text-[1.3rem] md:text-[2.8rem] font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] uppercase italic tracking-tighter select-none leading-none mt-[-8px] md:mt-[-20px] pl-1 md:pl-3 whitespace-nowrap">
                        Made it to Round {currentRound}
                      </div>
                    </div>
                  )}

                  <div
                    className="flex flex-col items-center animate-slide-up-pop w-full"
                    style={{
                      animationDelay: "0s",
                      opacity: 0,
                      animationFillMode: "forwards",
                    }}
                  >
                    {!isInfiniteMode && <Robot state={robotState} />}
                    {/* Redundant Game Over Panel Removed */}

                    <div className="flex flex-col items-center gap-3 md:gap-5 mt-4 md:mt-16 w-full max-w-sm">
                      {isFinished && !isPerfect && (
                        <div className="flex flex-col items-center gap-4 w-full">
                          <button
                            onClick={async () => {
                              // Stop any pending recording timeout
                              if (stopRecordingTimeoutRef.current !== null) {
                                clearTimeout(stopRecordingTimeoutRef.current);
                                stopRecordingTimeoutRef.current = null;
                              }

                              // If still recording, stop it now and wait for completion
                              if (isRecording) {
                                await stopRecording();
                              }

                              // Now start fresh game with new recording
                              if (isInfiniteMode) {
                                // Replay the round they just lost on at current BPM
                                startGame(
                                  undefined,
                                  infiniteBpmRef.current,
                                  infiniteLengthRef.current
                                );
                              } else {
                                startGame();
                              }
                            }}
                            className="px-12 py-5 bg-red-600 text-white font-black uppercase tracking-widest text-xl hover:bg-red-700 active:scale-95 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.5)] rounded-2xl w-full min-w-[280px]"
                          >
                            {isInfiniteMode
                              ? `REPLAY ROUND ${currentRound}`
                              : "TRY AGAIN"}
                          </button>

                          <button
                            onClick={() => {
                              setDifficulty("EASY");
                              setIsInfiniteMode(true);
                              setCurrentRound(1);
                              currentRoundRef.current = 1;
                              setCurrentBpm(100);
                              setCurrentLength(8);
                              setStatus(GameStatus.LOADING);
                            }}
                            className="text-white/60 text-xs font-bold uppercase tracking-[0.2em] hover:text-white transition-colors mt-2"
                          >
                            Back to Menu
                          </button>
                        </div>
                      )}

                      {isFinished && isPerfect && (
                        <div className="flex flex-col items-center gap-4 w-full">
                          {isInfiniteMode ? (
                            <button
                              onClick={() => {
                                currentRoundRef.current += 1;
                                const nextRoundNum = currentRoundRef.current;
                                const nextBpm = 100 + (nextRoundNum - 1) * 5;
                                const nextLength = 8 + (nextRoundNum - 1) * 3;

                                infiniteBpmRef.current = nextBpm;
                                infiniteLengthRef.current = nextLength;
                                setCurrentBpm(Math.round(nextBpm));
                                setCurrentLength(nextLength);
                                setCurrentRound(nextRoundNum);
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
                              {difficulty === "NIGHTMARE"
                                ? "FINISH"
                                : "NEXT ROUND"}
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              // Stop any pending recording timeout
                              if (stopRecordingTimeoutRef.current !== null) {
                                clearTimeout(stopRecordingTimeoutRef.current);
                                stopRecordingTimeoutRef.current = null;
                              }

                              // If still recording, stop it now and wait for completion
                              if (isRecording) {
                                await stopRecording();
                              }

                              startGame();
                            }}
                            className="text-white text-[11px] md:text-xs font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] opacity-60 hover:opacity-100 transition-opacity underline underline-offset-8"
                          >
                            Replay Level
                          </button>
                        </div>
                      )}

                      {/* NEW SHARING SECTION */}
                      <div
                        className="flex flex-col items-center gap-4 mt-8 w-full animate-slide-up-pop"
                        style={{
                          animationDelay: hideForInfiniteFail ? "0.8s" : "0s",
                          opacity: 0,
                          animationFillMode: "forwards",
                        }}
                      >
                        {/* Primary Share CTA */}
                        <div className="flex flex-col items-center gap-2 w-full">
                          <button
                            disabled={isRecording || !videoBlob}
                            onClick={() => handleShare("system")}
                            className={`group relative px-12 py-5 rounded-2xl font-black text-xl tracking-widest transition-all shadow-[0_8px_20px_rgba(0,0,0,0.4)] w-full min-w-[280px] flex items-center justify-center gap-3 overflow-hidden ${
                              isRecording || !videoBlob
                                ? "bg-white/10 text-white/30 cursor-not-allowed"
                                : "bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:scale-[1.02] active:scale-95"
                            }`}
                          >
                            <span className="relative z-10">
                              {isRecording || !videoBlob
                                ? "PREPARING VIDEO..."
                                : "SHARE THIS VIDEO"}
                            </span>
                            {!isRecording && videoBlob && (
                              <span className="text-2xl">🔥</span>
                            )}
                            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out pointer-events-none" />
                          </button>
                          {status === GameStatus.RESULT && isRecording && (
                            <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest animate-pulse">
                              Processing High-Quality Export...
                            </p>
                          )}
                          {/* Secondary Save CTA */}
                          <button
                            disabled={isRecording || !videoBlob}
                            onClick={handleSaveVideo}
                            className="flex items-center gap-2 px-6 py-3 text-white/70 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest disabled:opacity-0"
                          >
                            <Download size={18} />
                            <span>Save video</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* MODALS */}
        <ShareInstructionsModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          target={activeShareTarget || "system"}
          isDownloaded={isVideoDownloaded}
          showSaveToast={showSaveToast}
          onDownload={handleSaveVideo}
          roundNumber={currentRound}
        />
      </div>
    </div>
  );
};

export default App;
