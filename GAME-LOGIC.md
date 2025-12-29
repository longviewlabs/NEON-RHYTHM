# 🎮 FINGER RHYTHM - Game Logic Documentation

> **Purpose**: This document summarizes the core game logic for AI agents and developers working on this codebase.

---

## 📋 Quick Overview

| Aspect | Description |
|--------|-------------|
| **Game Type** | Rhythm/reflex game with hand tracking |
| **Input Method** | Webcam-based finger counting (MediaPipe/TensorFlow.js) |
| **Core Mechanic** | Match displayed finger counts to beat-synced sequences |
| **Music** | Programmatic synthesis (no MP3 during gameplay) |
| **Target Platform** | Web (desktop + mobile browsers) |

---

## 🔄 Game State Machine

```
LOADING → MENU → PLAYING → ANALYZING → RESULT
                    ↓           ↓          ↓
                TRANSITION ←────┘     (REPLAY/MENU)
                    ↓
                 PLAYING (next round)
```

### State Definitions (`types.ts`)
- **LOADING**: Assets loading, model initialization, start screen
- **MENU**: Mode selection (currently bypassed, goes straight to game)
- **PLAYING**: Active gameplay, sequence displayed, hand detection active
- **TRANSITION**: Between rounds (infinite mode), showing "Round X cleared"
- **ANALYZING**: Post-round analysis (currently instant for local mode)
- **RESULT**: Score display, share options, replay/continue buttons

---

## 🎯 Core Gameplay Loop

### 1. Sequence Generation (`App.tsx` → `generateSequence()`)
```typescript
// Generates random 1-5 finger sequences with rules:
// - No immediate duplicates (e.g., no "3-3")
// - No 3 consecutive ascending (e.g., no "1-2-3")
// - Length determined by difficulty/round
```

### 2. Beat Synchronization (`App.tsx` → `runSequence()`)
- Uses **AudioContext timing** for precise sync
- Beats scheduled via `requestAnimationFrame` scheduler
- UI highlight updates ~15ms before actual beat time
- **Judgement happens at 90%** into each beat interval

### 3. Hit Detection (`useHandDetection.ts` + `App.tsx`)
- **Primary**: Real-time `fingerCountRef` comparison at judgement time
- **Secondary**: `hitBeatsRef` latching (if user hit target at ANY point during beat)
- **Tolerance**: Uses "latching" to handle detection flickering

### 4. Scoring
- **Local Mode** (default): Instant real-time feedback
- **AI Mode** (disabled): Would use Gemini Vision API for frame analysis
- Pass condition: **All beats correct** to proceed to next round
- Fail condition: **Any single miss** ends the run (infinite mode)

---

## 🖐️ Hand Detection System

### Detection Engines (`hooks/useHandDetection.ts`)
| Engine | Model | Performance | Use Case |
|--------|-------|-------------|----------|
| **MediaPipe** | `hand_landmarker.task` | More accurate | Default |
| **TensorFlow.js** | `MediaPipeHands` | Faster on some devices | Optional |

### Finger Counting Algorithm (`countFingers()`)
```typescript
// Uses 21 hand landmarks
// Thumb: Distance-based (tip vs IP joint relative to pinky knuckle)
// Fingers: Tip-to-wrist distance > MCP-to-wrist distance * 1.35
// Smoothing: Mode of last 3-5 readings
```

### Key Landmarks Used
- Wrist (0), Thumb tip (4), Index MCP (5), Index tip (8)
- Middle tip (12), Ring tip (16), Pinky MCP (17), Pinky tip (20)

---

## 🎵 Audio System

### Rhythm Engine (`hooks/useRhythmEngine.ts`)
- **Programmatic synthesis** - no audio files during gameplay
- Generates: Kick, Snare, Hi-hat, Ride, Bass, Melody
- **16-step sequencer** with configurable BPM
- Pattern: `happy_hardcore` (4/4 kick, off-beat bass)

### Audio Files Used
| File | Purpose |
|------|---------|
| `/before-game.mp3` | Menu/loading background |
| `/winning-sound.mp3` | Round clear sound effect |
| `/losing-sound.mp3` | Fail sound effect |

### Sound Effects (Synthesized)
- **Countdown beep**: Frequency ramps 400→700Hz
- **Metronome tick**: 1200Hz (beat 1) / 800Hz (other beats)
- **Success chime**: C Major triad (C5-E5-G5)
- **Fail buzzer**: Sawtooth wave 150→50Hz

---

## ♾️ Infinite Mode Progression

### Difficulty Scaling
```typescript
Round N → {
  BPM: 100 + (N-1) * 5,      // 100, 105, 110, 115...
  Length: 8 + (N-1) * 3       // 8, 11, 14, 17, 20...
}
```

### Round Flow
1. Generate new sequence at next BPM/length
2. 3-2-1 countdown synced to music downbeat
3. Play sequence
4. On **success**: 1.5s pause → TRANSITION (3s) → next round
5. On **fail**: Instant stop → show "FAIL" with round reached

---

## 📹 Video Recording System

### Architecture (`hooks/useVideoRecorder.ts` + `videoRecorder.worker.ts`)
- **Web Worker** handles frame processing (offloads main thread)
- **Canvas capture** via `captureStream()` at 20-24 FPS
- **Overlays**: Round number, BPM, sequence progress, FAIL stamp
- **Codec priority**: H.264 MP4 → WebM fallback

### Recording Lifecycle
1. Starts when game begins (first round)
2. **Continuous** through round transitions (no restart)
3. Stops 3 seconds after game over (captures reaction)

---

## 🗂️ File Structure Overview

```
src/
├── App.tsx                    # Main game orchestrator (1400+ lines)
├── types.ts                   # GameStatus enum, interfaces
├── constants.ts               # Track configs, chart generation
├── hooks/
│   ├── useHandDetection.ts    # Unified detection hook
│   ├── useMediaPipe.ts        # MediaPipe-specific (legacy)
│   ├── useRhythmEngine.ts     # Programmatic music engine
│   ├── useVideoRecorder.ts    # Recording hook
│   └── videoRecorder.worker.ts # Frame processing worker
├── components/
│   ├── StartScreen.tsx        # Entry point UI
│   ├── PlayingView.tsx        # In-game display wrapper
│   ├── SequenceDisplay.tsx    # Number sequence visualization
│   ├── ResultView.tsx         # Score + share UI
│   ├── CountdownOverlay.tsx   # 3-2-1 countdown
│   ├── TransitionOverlay.tsx  # "Round X Cleared" screen
│   └── BackgroundManager.tsx  # Webcam feed + effects
└── utils/
    └── shareUtils.ts          # Social sharing helpers
```

---

## 🔑 Key Refs to Know

| Ref | Type | Purpose |
|-----|------|---------|
| `fingerCountRef` | `number` | Current detected finger count |
| `hitBeatsRef` | `boolean[]` | Latched hits per beat index |
| `currentBeatRef` | `number` | Index of active beat (-1 when idle) |
| `sessionIdRef` | `number` | Prevents stale async callbacks |
| `aiResultsRef` | `(boolean\|null)[]` | Per-beat scoring results |

---

## ⚠️ Critical Implementation Notes

### 1. Audio Context Unlocking (iOS)
```typescript
// Must resume on user gesture
if (ctx.state === "suspended") await ctx.resume();
// Play silent buffer to unlock hardware
```

### 2. Beat Timing Precision
- Uses `AudioContext.currentTime` (not `Date.now()`)
- UI updates scheduled 15ms early for perceived sync
- Judgement happens at 90% of beat interval (not end)

### 3. Memory Management
- `cleanupTempData()` clears timers/frames between rounds
- Worker ImageBitmaps are `.close()`d immediately after use
- RAF loops tracked and cancelled on cleanup

### 4. Detection Stability
- Mode-based smoothing (last 3-5 readings)
- Latching prevents flickering during hold
- Throttled to ~55ms (MediaPipe) or ~35ms (TensorFlow)

---

## 🧪 Testing Focus Areas

1. **Beat sync accuracy** across different BPMs
2. **Finger detection** under various lighting conditions
3. **Memory leaks** during extended play sessions
4. **Video export** quality and codec compatibility
5. **iOS Safari** audio unlocking
6. **Round transitions** seamless music continuation

---

## 📊 Difficulty Presets (Non-Infinite Mode)

| Level | Name | BPM | Length | Color |
|-------|------|-----|--------|-------|
| EASY | Vibe Check | 95 | 8 | Green |
| MEDIUM | In The Groove | 110 | 8 | White |
| HARD | Hyper Focus | 130 | 11 | White |
| NIGHTMARE | Virtuoso | 150 | 14 | Red |

*Note: Infinite mode is the default and starts at BPM 100, length 8.*

---

## 🔧 Quick Commands for Development

```bash
# Start dev server
npm run dev

# The game runs on port configured in vite.config.ts
# Default: http://localhost:5173
```

---

*Last updated: Dec 29, 2025*

