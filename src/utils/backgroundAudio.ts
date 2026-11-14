let activeWakeLock: WakeLockSentinel | null = null;
let silentLoopBlobUrl: string | null = null;

/**
 * Generates an in-memory 2-second 8000Hz 16-bit mono PCM WAV Blob URL.
 * Playing this with `audio.loop = true` synchronously inside a user tap gesture (0ms latency)
 * immediately activates Android Chrome's hardware AudioTrack and MediaSession before the network
 * stream finishes downloading, preventing tab-switch or background suspension during track load.
 */
export function getSilentLoopBlobUrl(): string {
  if (silentLoopBlobUrl) return silentLoopBlobUrl;
  const sampleRate = 8000;
  const numSamples = sampleRate * 2; // 2 seconds
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  // PCM samples default to 0 (silence)

  const blob = new Blob([buffer], { type: 'audio/wav' });
  silentLoopBlobUrl = URL.createObjectURL(blob);
  return silentLoopBlobUrl;
}

export async function acquirePlaybackWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
  if (document.visibilityState !== 'visible') return;
  if (activeWakeLock && !activeWakeLock.released) return;
  try {
    activeWakeLock = await navigator.wakeLock.request('screen');
    activeWakeLock.addEventListener('release', () => {
      activeWakeLock = null;
    });
  } catch {
    // Wake Lock unsupported or blocked by battery saver
  }
}

export async function releasePlaybackWakeLock(): Promise<void> {
  if (!activeWakeLock) return;
  try {
    await activeWakeLock.release();
  } catch {
    // ignore
  }
  activeWakeLock = null;
}

let keepAliveCtx: AudioContext | null = null;
let keepAliveOsc: OscillatorNode | null = null;

export function startWebAudioKeepAlive(): void {
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    if (!keepAliveCtx) {
      keepAliveCtx = new AudioCtx();
      const gain = keepAliveCtx.createGain();
      gain.gain.value = 0.0001; // Sub-audible (-80 dBFS at 1 Hz) so Chromium silence detector never suspends the audio thread
      keepAliveOsc = keepAliveCtx.createOscillator();
      keepAliveOsc.frequency.value = 1;
      keepAliveOsc.connect(gain);
      gain.connect(keepAliveCtx.destination);
      keepAliveOsc.start();
    }
    if (keepAliveCtx.state === 'suspended') {
      void keepAliveCtx.resume().catch(() => {});
    }
  } catch {
    // ignore if AudioContext blocked prior to user gesture
  }
}

export function stopWebAudioKeepAlive(): void {
  if (!keepAliveCtx) return;
  try {
    if (keepAliveCtx.state === 'running') {
      void keepAliveCtx.suspend().catch(() => {});
    }
  } catch {
    // ignore
  }
}

export async function registerVibraServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    // Unregister any old /sw.js service worker so it never conflicts with host proxy service workers
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      if (reg.active?.scriptURL?.endsWith('/sw.js')) {
        await reg.unregister();
      }
    }
  } catch {
    // ignore
  }
  return null;
}
