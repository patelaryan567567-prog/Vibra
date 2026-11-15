let activeWakeLock: WakeLockSentinel | null = null;
let silentLoopBlobUrl: string | null = null;

/**
 * Generates an in-memory 2-second 8000Hz 16-bit mono PCM WAV Blob URL with non-zero
 * sub-audible dithering (±2 LSB out of 32767, ~ -84 dBFS).
 * Using non-zero PCM samples prevents Android Chrome / iOS hardware silence detectors
 * from classifying the audio stream as digital zero-silence and suspending the background process.
 */
export function getSilentLoopBlobUrl(): string {
  if (silentLoopBlobUrl) return silentLoopBlobUrl;
  const sampleRate = 8000;
  const numSamples = sampleRate * 2; // 2 seconds
  const dataSize = numSamples * 2; // 16-bit mono (32 KB)
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

  // Fill with non-zero sub-audible triangle/alternating dither (±2 out of 32767)
  // so mobile OS audio daemons never treat the buffer as digital silence.
  for (let i = 0; i < numSamples; i++) {
    const sample = (i & 1) === 0 ? 2 : -2;
    view.setInt16(44 + i * 2, sample, true);
  }

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
let keepAliveAudioEl: HTMLAudioElement | null = null;
let keepAliveTimer: number | null = null;
let isKeepAliveActive = false;

function ensureKeepAliveBridgeAudio(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  if (!keepAliveAudioEl) {
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.loop = true;
    el.volume = 0.01;
    el.muted = false;
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    el.style.display = 'none';
    el.src = getSilentLoopBlobUrl();
    document.body.appendChild(el);
    keepAliveAudioEl = el;
  }
  return keepAliveAudioEl;
}

export function pokeBackgroundKeepAlive(): void {
  if (!isKeepAliveActive || typeof window === 'undefined') return;
  try {
    if (keepAliveCtx && keepAliveCtx.state === 'suspended') {
      void keepAliveCtx.resume().catch(() => {});
    }
  } catch {
    // ignore
  }
  try {
    const bridge = ensureKeepAliveBridgeAudio();
    if (bridge && bridge.paused) {
      bridge.loop = true;
      bridge.volume = 0.01;
      if (!bridge.src) bridge.src = getSilentLoopBlobUrl();
      void bridge.play().catch(() => {});
    }
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void acquirePlaybackWakeLock();
  }
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'VIBRA_KEEP_ALIVE_PING',
        ts: Date.now(),
      });
    }
  } catch {
    // ignore
  }
}

export function startWebAudioKeepAlive(): void {
  if (typeof window === 'undefined') return;
  isKeepAliveActive = true;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (AudioCtx) {
    try {
      if (!keepAliveCtx) {
        keepAliveCtx = new AudioCtx();
        const gain = keepAliveCtx.createGain();
        gain.gain.value = 0.0002; // Sub-audible non-zero gain so Chromium silence detector never suspends the audio thread
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

  try {
    const bridge = ensureKeepAliveBridgeAudio();
    if (bridge && bridge.paused) {
      bridge.loop = true;
      bridge.volume = 0.01;
      void bridge.play().catch(() => {});
    }
  } catch {
    // ignore
  }

  if (keepAliveTimer === null) {
    keepAliveTimer = window.setInterval(() => {
      if (!isKeepAliveActive) return;
      pokeBackgroundKeepAlive();
    }, 3500);
  }
}

export function stopWebAudioKeepAlive(): void {
  isKeepAliveActive = false;
  if (keepAliveTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (keepAliveCtx) {
    try {
      if (keepAliveCtx.state === 'running') {
        void keepAliveCtx.suspend().catch(() => {});
      }
    } catch {
      // ignore
    }
  }
  if (keepAliveAudioEl) {
    try {
      keepAliveAudioEl.pause();
    } catch {
      // ignore
    }
  }
}

export async function registerVibraServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch {
    return null;
  }
}
