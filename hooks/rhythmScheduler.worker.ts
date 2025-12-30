/**
 * Web Worker for Rhythm Engine Scheduler
 * 
 * This worker handles the 25ms timing loop for audio scheduling,
 * freeing the main thread from timer interrupts during gameplay.
 * 
 * Communication Protocol:
 * - Main -> Worker: { type: 'start' | 'stop' | 'setBpm', bpm?: number }
 * - Worker -> Main: { type: 'tick' }
 */

let intervalId: ReturnType<typeof setInterval> | null = null;
const LOOKAHEAD_MS = 25; // How often to check for notes to schedule

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  switch (type) {
    case 'start':
      // Clear any existing interval
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      // Start the timing loop - sends 'tick' messages to main thread
      intervalId = setInterval(() => {
        self.postMessage({ type: 'tick' });
      }, LOOKAHEAD_MS);
      break;

    case 'stop':
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      break;

    default:
      break;
  }
};

// Export empty to make TypeScript happy (this is a worker module)
export {};

