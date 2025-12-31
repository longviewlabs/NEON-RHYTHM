/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useHandDetection } from "./hooks/useHandDetection";
import Robot from "./components/Robot";
import BackgroundManager from "./components/BackgroundManager";
import PlayingView from "./components/PlayingView";
import SettingsModal from "./components/SettingsModal";
import StartScreen from "./components/StartScreen";
import MenuView from "./components/MenuView";
import ResultView from "./components/ResultView";
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
  DETECTION_WINDOW_PERCENT,
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
  const resultRevealIntervalRef = useRef<number | null>(null);

  // Tracking
  const [status, setStatus] = useState<GameStatus>(GameStatus.LOADING);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [sequence, setSequence] = useState<number[]>([]);

  const statusRef = useRef<GameStatus>(GameStatus.LOADING);
  const currentBeatRef = useRef(-1);
  const sequenceRef = useRef<number[]>([]);

  // Sync refs with state
  useEffect(() => {
    statusRef.current = status;
    currentBeatRef.current = currentBeat;
    sequenceRef.current = sequence;
  }, [status, currentBeat, sequence]);

  // Detection Engine: MediaPipe only (faster & more stable across all platforms)

  // Infinite Mode State
  const [currentBpm, setCurrentBpm] = useState(95);

  // Countdown state
  const [countdown, setCountdown] = useState<number | null>(null);

  const handleFingerCountUpdate = useCallback((count: number) => {
    fingerCountRef.current = count;

    // Only check during active gameplay
    if (statusRef.current !== GameStatus.PLAYING) return;
    if (sequenceRef.current.length === 0) return;

    // Get current audio time for ±75% window detection
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const currentTime = ctx.currentTime;
    const firstBeatTime = firstBeatTimeRef.current;
    const interval = beatIntervalRef.current;
    const windowSize = interval * DETECTION_WINDOW_PERCENT;

    // Check ALL beats within the ±75% detection window
    for (let beatIdx = 0; beatIdx < sequenceRef.current.length; beatIdx++) {
      // Skip if already hit
      if (hitBeatsRef.current[beatIdx]) continue;

      const beatTime = firstBeatTime + beatIdx * interval;
      const windowStart = beatTime - windowSize;
      const windowEnd = beatTime + windowSize;

      // Check if current time is within this beat's detection window
      if (currentTime >= windowStart && currentTime <= windowEnd) {
        const target = sequenceRef.current[beatIdx];
        if (count === target) {
          console.log(`[HIT-WINDOW] Beat ${beatIdx}: count=${count} matches target=${target} (window: ${windowStart.toFixed(2)}-${windowEnd.toFixed(2)}, now: ${currentTime.toFixed(2)})`);
          hitBeatsRef.current[beatIdx] = true;
        }
      }
    }
  }, []);

  // Hand detection - MediaPipe for all platforms
  const { isCameraReady, landmarksRef, fingerCountRef, isModelLoading } =
    useHandDetection(videoRef, handleFingerCountUpdate, currentBpm);
  const rhythmEngine = useRhythmEngine(
    audioCtxRef.current,
    recorderGainRef.current
  );

  // Track Rotation State (Simplified to one track)
  const currentPattern: MusicType = "happy_hardcore";

  // Ref to track if target was hit for each beat index (prevents race conditions)
  const hitBeatsRef = useRef<boolean[]>([]);

  // Beat timing refs for ±75% detection window
  const firstBeatTimeRef = useRef<number>(0);
  const beatIntervalRef = useRef<number>(0.5); // seconds per beat

  // AI Results Refs (for logic and polling)
  const aiResultsRef = useRef<(boolean | null)[]>([]);
  const aiDetectedCountsRef = useRef<number[][]>([]);

  // Game State
  const [difficulty, setDifficulty] = useState<Difficulty>("EASY");
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
    clearVideo,
    isActuallyRecording,
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
    // 1. Clear standard timers and animation frames
    // Note: gameTimersRef may contain both setTimeout IDs and requestAnimationFrame IDs
    gameTimersRef.current.forEach((id) => {
      if (id) {
        clearInterval(id as any);
        clearTimeout(id as any);
        cancelAnimationFrame(id as any); // Also cancel any RAF IDs from countdown
      }
    });
    gameTimersRef.current = [];

    // 2. Kill the high-frequency game loop (CPU fix)
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // 3. Clear any pending recording stop timeout
    if (stopRecordingTimeoutRef.current !== null) {
      clearTimeout(stopRecordingTimeoutRef.current);
      stopRecordingTimeoutRef.current = null;
    }
    
    // 4. Clear result reveal interval (prevents stacking intervals bug)
    if (resultRevealIntervalRef.current !== null) {
      clearInterval(resultRevealIntervalRef.current);
      resultRevealIntervalRef.current = null;
    }

    // 5. Reset ALL game state
    setCapturedFrames([]);
    setLocalResults([]);
    setAiResults([]);
    setRevealedResults([]);
    setAiDetectedCounts([]);
    setCountdown(null);
    setSequence([]);
    setCurrentBeat(-1);
    
    // 6. Reset ALL refs to prevent stale data
    aiResultsRef.current = [];
    aiDetectedCountsRef.current = [];
    hitBeatsRef.current = [];
    firstBeatTimeRef.current = 0;
    beatIntervalRef.current = 0.5;
    sequenceRef.current = [];
    currentBeatRef.current = -1;
  }, []);

  // Handle Score Screen Reveal Logic and Sounds
  useEffect(() => {
    // CRITICAL: Always clear previous interval before creating new one
    if (resultRevealIntervalRef.current !== null) {
      clearInterval(resultRevealIntervalRef.current);
      resultRevealIntervalRef.current = null;
    }
    
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
            resultRevealIntervalRef.current = null;
          }
        }, 300);
        resultRevealIntervalRef.current = interval as unknown as number;
        return () => {
          clearInterval(interval);
          resultRevealIntervalRef.current = null;
        };
      } else {
        // AI MODE: Sync revealedResults with aiResults as they come
        // We use a staggered reveal for already available results,
        // and then the next effect handles ones that arrive late.
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
            resultRevealIntervalRef.current = null;
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
        resultRevealIntervalRef.current = interval as unknown as number;
        return () => {
          clearInterval(interval);
          resultRevealIntervalRef.current = null;
        };
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

    const beatDuration = 60 / targetBPM;
    const countdownDuration = 5 * beatDuration; // 5 beats for countdown

    if (rhythmEngine.isActive()) {
      // SEAMLESS CONTINUATION:
      // Start countdown immediately from current time
      firstBeatTime = ctx.currentTime + countdownDuration + 0.1;
    } else {
      // START TRACK (Fresh Game):
      const musicStartTime = ctx.currentTime + 0.1;
      firstBeatTime = musicStartTime + countdownDuration;

      rhythmEngine.start(targetBPM, "happy_hardcore", musicStartTime);

      // Only start recording if not already recording
      // This keeps the recording continuous during round transitions
      // Use isActuallyRecording() to check real MediaRecorder state, not stale React state
      if (!isActuallyRecording()) {
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
  // Uses requestAnimationFrame + AudioContext.currentTime for precise timing
  // This avoids setTimeout drift issues caused by JS event loop delays
  const startCountdown = (
    newSequence: number[],
    currentSessionId: number,
    firstBeatTime: number,
    bpm: number
  ) => {
    const beatDuration = 60 / bpm;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // Calculate exact times for each countdown beat using AudioContext clock
    // This ensures perfect sync with the music regardless of CPU load
    const countdownBeats = [5, 4, 3, 2, 1, 0].map((count) => ({
      count,
      time: firstBeatTime - count * beatDuration,
      triggered: false,
    }));

    let rafId: number;

    const tick = () => {
      // Early exit if session changed (game cancelled/restarted)
      if (sessionIdRef.current !== currentSessionId) {
        cancelAnimationFrame(rafId);
        return;
      }

      const now = ctx.currentTime;

      // Check each beat and trigger if AudioContext time has passed
      countdownBeats.forEach((beat) => {
        if (!beat.triggered && now >= beat.time) {
          beat.triggered = true;

          if (beat.count > 0) {
            setCountdown(beat.count);
            playCountdownBeep(beat.count);
          } else {
            setCountdown(null);
            playCountdownBeep(0);
          }
        }
      });

      // Continue loop until all beats are triggered
      const allDone = countdownBeats.every((b) => b.triggered);
      if (!allDone) {
        rafId = requestAnimationFrame(tick);
      }
    };

    // Start the animation frame loop
    rafId = requestAnimationFrame(tick);

    // Store rafId for cleanup (cast to match timer type)
    gameTimersRef.current.push(
      rafId as unknown as ReturnType<typeof setTimeout>
    );
  };

  const runSequence = (
    seq: number[],
    currentSessionId: number,
    firstBeatTime: number,
    bpm: number
  ) => {
    const intervalSec = 60 / bpm;

    // Store beat timing in refs for ±75% detection window in handleFingerCountUpdate
    firstBeatTimeRef.current = firstBeatTime;
    beatIntervalRef.current = intervalSec;

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

          /* 
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
          */

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
                cancelAnimationFrame(id as any); // Also cancel countdown RAF
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
                const addedBeats = ((nextRound - 1) * (nextRound - 1 + 5)) / 2;
                const nextLength = 8 + addedBeats;
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
              // const flattened = beatFrameGroups
              //   .flat()
              //   .filter((f) => f !== null) as string[];
              // setCapturedFrames(flattened);
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

  /*
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
  */

  const analyzeGame = async (
    seq: number[],
    localResults: (boolean | null)[],
    sessionId: number
  ) => {
    setStatus(GameStatus.ANALYZING);
    setRobotState("analyzing");

    // Calculate local score
    const localCorrectCount = localResults.filter((r) => r === true).length;
    const localScore = Math.round((localCorrectCount / seq.length) * 100);

    // Skip AI analysis and show results immediately based on LOCAL tracking
    const isPerfect = localScore === 100;
    const syncResults = localResults.map((r) => r === true);

    setRobotState("average");
    setResultData({
      success: isPerfect,
      correct_count: localCorrectCount,
      score: localScore,
      feedback: isPerfect ? "Perfect rhythm!" : "Game complete.",
      detailed_results: syncResults,
      detected_counts: aiDetectedCountsRef.current.flat(),
    });

    // Sync results immediately
    aiResultsRef.current = syncResults;
    setAiResults(syncResults);
    setAiDetectedCounts([...aiDetectedCountsRef.current]);

    // Move to result screen
    setStatus(GameStatus.RESULT);
  };

  // --- RENDER ---
  const currentBpmForCalc = isInfiniteMode
    ? currentBpm
    : DIFFICULTIES[difficulty].bpm;
  const beatDuration = 60 / currentBpmForCalc; // in seconds

  return (
    <div className="relative w-full h-screen bg-[#050510] overflow-hidden text-white font-sans selection:bg-[#ff00ff]">
      {/* Background & Overlays extracted for performance */}
      <BackgroundManager
        canvasRef={canvasRef}
        videoRef={videoRef}
        landmarksRef={landmarksRef}
        fingerCountRef={fingerCountRef}
        isCameraReady={isCameraReady}
        videoOpacity={videoOpacity}
        showFlash={showFlash}
        status={status}
      />

      {/* Main Content Container */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-3 md:p-4">
        {/* --- LOADING STATE --- */}
        {status === GameStatus.LOADING && (
          <StartScreen
            onStart={handleStartGame}
            isAssetsReady={isAssetsReady && !isModelLoading}
          />
        )}

        {/* --- MENU STATE --- */}
        {status === GameStatus.MENU && (
          <MenuView
            isCameraReady={isCameraReady}
            onStartInfinite={() => {
              setCurrentBpm(95);
              setCurrentLength(8);
              setCurrentRound(1);
              startGame(undefined, 95, 8);
            }}
          />
        )}

        {/* --- PLAYING / ANALYZING / TRANSITION STATE --- */}
        <PlayingView
          status={status}
          currentRound={currentRound}
          currentBpm={currentBpm}
          displayRound={displayRound}
          exitingRound={exitingRound}
          countdown={countdown}
          sequence={sequence}
          currentBeat={currentBeat}
          localResults={localResults}
        />

        {/* --- RESULT STATE --- */}
        {status === GameStatus.RESULT && (
          <div
            className="flex flex-col items-center justify-center gap-2 md:gap-6 w-full max-w-4xl animate-pop px-3 md:px-4 h-full relative"
            style={{ paddingBottom: 20 }}
          >
            <ResultView
              revealedResults={revealedResults}
              sequence={sequence}
              isInfiniteMode={isInfiniteMode}
              currentRound={currentRound}
              robotState={robotState}
              isRecording={isRecording}
              videoBlob={videoBlob}
              isVideoDownloaded={isVideoDownloaded}
              showSaveToast={showSaveToast}
              onReplay={async () => {
                // CRITICAL: Full cleanup before replay
                if (stopRecordingTimeoutRef.current !== null) {
                  clearTimeout(stopRecordingTimeoutRef.current);
                  stopRecordingTimeoutRef.current = null;
                }
                
                // Clear stale video data BEFORE stopping
                clearVideo();
                
                if (isRecording) await stopRecording();
                
                // Stop music and clear all game state
                stopMusic();
                cleanupTempData();
                
                // Replay from CURRENT round (not round 1)
                // Keep the same BPM and length where user failed
                if (isInfiniteMode) {
                  startGame(
                    undefined,
                    infiniteBpmRef.current,
                    infiniteLengthRef.current
                  );
                } else {
                  startGame();
                }
              }}
              onBackToMenu={() => {
                // CRITICAL: Full cleanup to prevent memory leaks
                clearVideo();
                cleanupTempData();
                stopMusic();
                
                // Reset infinite mode refs
                infiniteBpmRef.current = 100;
                infiniteLengthRef.current = 8;
                currentRoundRef.current = 1;
                
                // Reset all state
                setDifficulty("EASY");
                setIsInfiniteMode(true);
                setCurrentRound(1);
                setCurrentBpm(100);
                setCurrentLength(8);
                setRobotState("average");
                setResultData(null);
                setStatus(GameStatus.LOADING);
              }}
              onNextRound={() => {
                if (isInfiniteMode) {
                  currentRoundRef.current += 1;
                  const nextRoundNum = currentRoundRef.current;
                  const nextBpm = 100 + (nextRoundNum - 1) * 5;
                  const addedBeats =
                    ((nextRoundNum - 1) * (nextRoundNum - 1 + 5)) / 2;
                  const nextLength = 8 + addedBeats;
                  infiniteBpmRef.current = nextBpm;
                  infiniteLengthRef.current = nextLength;
                  setCurrentBpm(Math.round(nextBpm));
                  setCurrentLength(nextLength);
                  setCurrentRound(nextRoundNum);
                  startGame(undefined, nextBpm, nextLength);
                } else {
                  const diffs = Object.keys(DIFFICULTIES) as Difficulty[];
                  const currentIndex = diffs.indexOf(difficulty);
                  const nextDifficulty = diffs[currentIndex + 1];
                  if (nextDifficulty) {
                    setDifficulty(nextDifficulty);
                    startGame(nextDifficulty);
                  } else {
                    setDifficulty("EASY");
                    setStatus(GameStatus.LOADING);
                  }
                }
              }}
              onShare={handleShare}
              onSaveVideo={handleSaveVideo}
            />
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
