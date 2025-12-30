import { useRef, useCallback, useEffect } from 'react';

export type MusicType = 'happy_hardcore';

export interface Pattern {
    name: string;
    type: 'trance' | 'dnb';
    desc: string;
    kick: number[];
    snare: number[];
    hihat: number[];
    ride: number[];
    bass: number[];
}

export const PATTERNS: Record<MusicType, Pattern> = {
    happy_hardcore: {
        name: "Happy Hardcore",
        type: "trance",
        desc: "Uplifting 4/4 kick with off-beat energetic bass.",
        kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        hihat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
        ride: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
        bass: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
    }
};

const MELODY_LOOP = [
    // Bar 1: C Major (C E G)
    [523.25, 0, 392.00, 0, 329.63, 0, 392.00, 0, 523.25, 0, 659.25, 0, 523.25, 0, 392.00, 0],
    // Bar 2: G Major (G B D)
    [392.00, 0, 293.66, 0, 246.94, 0, 293.66, 0, 392.00, 0, 587.33, 0, 392.00, 0, 293.66, 0],
    // Bar 3: A Minor (A C E)
    [440.00, 0, 329.63, 0, 261.63, 0, 329.63, 0, 440.00, 0, 523.25, 0, 440.00, 0, 329.63, 0],
    // Bar 4: F Major (F A C)
    [349.23, 0, 440.00, 0, 523.25, 0, 440.00, 0, 349.23, 0, 440.00, 0, 523.25, 0, 698.46, 0]
];

// Singleton Web Worker for scheduler timing (runs 25ms loop off main thread)
let schedulerWorker: Worker | null = null;
const getSchedulerWorker = (): Worker => {
    if (!schedulerWorker) {
        schedulerWorker = new Worker(
            new URL('./rhythmScheduler.worker.ts', import.meta.url),
            { type: 'module' }
        );
    }
    return schedulerWorker;
};

export const useRhythmEngine = (audioContext: AudioContext | null, destination?: AudioNode | null) => {
    const bpmRef = useRef(100);
    const volumeRef = useRef(0.6);
    const melodyVolumeRef = useRef(0.4);
    const selectedPatternRef = useRef<MusicType>('happy_hardcore');

    const nextNoteTimeRef = useRef(0);
    const current16thNoteRef = useRef(0);
    const measureRef = useRef(0);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const isActiveRef = useRef(false);
    const workerListenerRef = useRef<((e: MessageEvent) => void) | null>(null);

    const onBeatCallbackRef = useRef<(note: number, time: number, measure: number) => void>(() => { });

    const connectToDest = useCallback((node: AudioNode) => {
        if (destination) node.connect(destination);
        if (audioContext) node.connect(audioContext.destination);
    }, [audioContext, destination]);

    // Create Noise Buffer for synthesis
    useEffect(() => {
        if (!audioContext) return;
        const bufferSize = audioContext.sampleRate * 2;
        const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        noiseBufferRef.current = buffer;
    }, [audioContext]);

    // Synthesis Functions - use onended for cleanup instead of setTimeout
    const playKick = useCallback((time: number) => {
        if (!audioContext) return;
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        osc.connect(gainNode);
        connectToDest(gainNode);

        // Tight, punchy kick
        osc.frequency.setValueAtTime(180, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.3);

        gainNode.gain.setValueAtTime(volumeRef.current * 1.5, time);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        osc.start(time);
        osc.stop(time + 0.3);

        // Cleanup via onended callback (no setTimeout needed)
        osc.onended = () => {
            osc.disconnect();
            gainNode.disconnect();
        };
    }, [audioContext, connectToDest]);

    const playSnare = useCallback((time: number) => {
        if (!audioContext || !noiseBufferRef.current) return;
        const noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = noiseBufferRef.current;
        const noiseFilter = audioContext.createBiquadFilter();
        noiseFilter.type = "highpass";
        noiseFilter.frequency.value = 1000;
        const noiseGain = audioContext.createGain();
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        connectToDest(noiseGain);
        noiseGain.gain.setValueAtTime(volumeRef.current, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
        noiseSource.start(time);
        noiseSource.stop(time + 0.2);

        // Cleanup via onended
        noiseSource.onended = () => {
            noiseSource.disconnect();
            noiseFilter.disconnect();
            noiseGain.disconnect();
        };

        const osc = audioContext.createOscillator();
        const oscGain = audioContext.createGain();
        osc.connect(oscGain);
        connectToDest(oscGain);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, time);
        oscGain.gain.setValueAtTime(volumeRef.current * 0.5, time);
        oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
        osc.start(time);
        osc.stop(time + 0.1);

        // Cleanup via onended
        osc.onended = () => {
            osc.disconnect();
            oscGain.disconnect();
        };
    }, [audioContext, connectToDest]);

    const playHiHat = useCallback((time: number) => {
        if (!audioContext || !noiseBufferRef.current) return;
        const source = audioContext.createBufferSource();
        source.buffer = noiseBufferRef.current;
        const filter = audioContext.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 8000;
        const gainNode = audioContext.createGain();
        source.connect(filter);
        filter.connect(gainNode);
        connectToDest(gainNode);
        gainNode.gain.setValueAtTime(volumeRef.current * 0.4, time);
        gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
        source.start(time);
        source.stop(time + 0.05);

        // Cleanup via onended
        source.onended = () => {
            source.disconnect();
            filter.disconnect();
            gainNode.disconnect();
        };
    }, [audioContext, connectToDest]);

    const playRide = useCallback((time: number) => {
        if (!audioContext || !noiseBufferRef.current) return;

        const fundamental = 300;
        const ratios = [2, 3, 4.16, 5.43];
        ratios.forEach((ratio) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.type = "square";
            osc.frequency.value = fundamental * ratio;
            const filter = audioContext.createBiquadFilter();
            filter.type = "bandpass";
            filter.frequency.value = 5000;
            filter.Q.value = 1;
            osc.connect(filter);
            filter.connect(gain);
            connectToDest(gain);
            gain.gain.setValueAtTime(volumeRef.current * 0.1, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
            osc.start(time);
            osc.stop(time + 0.4);

            // Cleanup via onended
            osc.onended = () => {
                osc.disconnect();
                filter.disconnect();
                gain.disconnect();
            };
        });

        const noise = audioContext.createBufferSource();
        noise.buffer = noiseBufferRef.current;
        const noiseFilter = audioContext.createBiquadFilter();
        noiseFilter.type = "highpass";
        noiseFilter.frequency.value = 6000;
        const noiseGain = audioContext.createGain();
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        connectToDest(noiseGain);
        noiseGain.gain.setValueAtTime(volumeRef.current * 0.15, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
        noise.start(time);
        noise.stop(time + 0.3);

        // Cleanup via onended
        noise.onended = () => {
            noise.disconnect();
            noiseFilter.disconnect();
            noiseGain.disconnect();
        };
    }, [audioContext, connectToDest]);

    const playMelodyNote = useCallback((time: number, freq: number) => {
        if (!audioContext) return;
        // Super Saw effect: 2 detuned oscillators
        const osc1 = audioContext.createOscillator();
        const osc2 = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();

        osc1.type = "sawtooth";
        osc2.type = "sawtooth";

        osc1.frequency.value = freq;
        osc2.frequency.value = freq + 2; // Detune slightly

        filter.type = "lowpass";
        filter.frequency.value = 2000;
        filter.Q.value = 1;

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        connectToDest(gain);

        // Softer attack for melody
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(melodyVolumeRef.current * volumeRef.current, time + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

        osc1.start(time);
        osc2.start(time);
        osc1.stop(time + 0.25);
        osc2.stop(time + 0.25);

        // Cleanup via onended (only need one since they stop at same time)
        osc1.onended = () => {
            osc1.disconnect();
            osc2.disconnect();
            filter.disconnect();
            gain.disconnect();
        };
    }, [audioContext, connectToDest]);

    // Scheduling Engine
    const scheduleNote = useCallback((beatNumber: number, time: number) => {
        const pattern = PATTERNS[selectedPatternRef.current];

        if (pattern.kick[beatNumber]) playKick(time);
        if (pattern.snare[beatNumber]) playSnare(time);
        if (pattern.hihat[beatNumber]) playHiHat(time);
        if (pattern.ride?.[beatNumber]) playRide(time);

        if (pattern.bass?.[beatNumber]) {
            // High Saw bass with filter sweep
            const osc = audioContext?.createOscillator();
            const gain = audioContext?.createGain();
            const filter = audioContext?.createBiquadFilter();
            if (audioContext && osc && gain && filter) {
                osc.type = "sawtooth";
                osc.frequency.value = 87.31; // F2
                filter.type = "lowpass";
                filter.Q.value = 4;
                filter.frequency.setValueAtTime(200, time);
                filter.frequency.exponentialRampToValueAtTime(2000, time + 0.02);
                filter.frequency.exponentialRampToValueAtTime(200, time + 0.3);
                osc.connect(filter);
                filter.connect(gain);
                connectToDest(gain);
                gain.gain.setValueAtTime(volumeRef.current * 0.7, time);
                gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
                osc.start(time);
                osc.stop(time + 0.3);

                // Cleanup via onended
                osc.onended = () => {
                    osc.disconnect();
                    filter.disconnect();
                    gain.disconnect();
                };
            }
        }

        // Melody
        const barNotes = MELODY_LOOP[measureRef.current];
        const noteFreq = barNotes[beatNumber];
        if (noteFreq > 0) {
            playMelodyNote(time, noteFreq);
        }

        // Notify App of the beat (for UI sync)
        onBeatCallbackRef.current(beatNumber, time, measureRef.current);
    }, [audioContext, playKick, playSnare, playHiHat, playRide, playMelodyNote, connectToDest]);

    // Scheduler tick function - called by Web Worker every 25ms
    const schedulerTick = useCallback(() => {
        if (!audioContext || !isActiveRef.current) return;
        const scheduleAheadTime = 0.1; // seconds

        while (nextNoteTimeRef.current < audioContext.currentTime + scheduleAheadTime) {
            scheduleNote(current16thNoteRef.current, nextNoteTimeRef.current);
            const secondsPerBeat = 60.0 / bpmRef.current;
            nextNoteTimeRef.current += 0.25 * secondsPerBeat;
            current16thNoteRef.current++;
            if (current16thNoteRef.current === 16) {
                current16thNoteRef.current = 0;
                measureRef.current = (measureRef.current + 1) % 4;
            }
        }
    }, [audioContext, scheduleNote]);

    const start = useCallback((bpm: number, pattern: MusicType, startTime?: number) => {
        if (!audioContext) return;
        
        // Stop any existing playback first
        const worker = getSchedulerWorker();
        worker.postMessage({ type: 'stop' });
        
        // Remove old listener if exists
        if (workerListenerRef.current) {
            worker.removeEventListener('message', workerListenerRef.current);
        }
        
        // Reset state
        bpmRef.current = bpm;
        selectedPatternRef.current = pattern;
        current16thNoteRef.current = 0;
        measureRef.current = 0;
        nextNoteTimeRef.current = startTime || audioContext.currentTime + 0.1;
        isActiveRef.current = true;
        
        // Create new listener for worker ticks
        const listener = (e: MessageEvent) => {
            if (e.data.type === 'tick' && isActiveRef.current) {
                schedulerTick();
            }
        };
        workerListenerRef.current = listener;
        worker.addEventListener('message', listener);
        
        // Start the worker's timing loop
        worker.postMessage({ type: 'start' });
    }, [audioContext, schedulerTick]);

    const stop = useCallback(() => {
        isActiveRef.current = false;
        
        const worker = getSchedulerWorker();
        worker.postMessage({ type: 'stop' });
        
        // Remove listener
        if (workerListenerRef.current) {
            worker.removeEventListener('message', workerListenerRef.current);
            workerListenerRef.current = null;
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stop();
        };
    }, [stop]);

    const getNextDownbeat = useCallback((minDelaySeconds: number) => {
        if (!audioContext || !isActiveRef.current) return 0;

        const secondsPer16th = (60.0 / bpmRef.current) * 0.25;
        const secondsPerBar = secondsPer16th * 16;

        // nextNoteTimeRef is when current16thNoteRef will play
        let notesUntilZero = (16 - current16thNoteRef.current) % 16;
        let targetTime = nextNoteTimeRef.current + notesUntilZero * secondsPer16th;

        // Ensure it's far enough in the future
        while (targetTime < audioContext.currentTime + minDelaySeconds) {
            targetTime += secondsPerBar;
        }

        return targetTime;
    }, [audioContext]);

    const setBpm = useCallback((newBpm: number) => {
        bpmRef.current = newBpm;
    }, []);

    const setPattern = useCallback((newPattern: MusicType) => {
        selectedPatternRef.current = newPattern;
    }, []);

    const setOnBeat = useCallback((callback: (note: number, time: number, measure: number) => void) => {
        onBeatCallbackRef.current = callback;
    }, []);

    return {
        start,
        stop,
        setBpm,
        setPattern,
        setOnBeat,
        getNextDownbeat,
        isActive: () => isActiveRef.current
    };
};
