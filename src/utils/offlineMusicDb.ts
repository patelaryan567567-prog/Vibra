import type { OfflineTrack, Track } from '../types/music';
import { formatSeconds } from './format';

const DB_NAME = 'vibra_offline_music_v1';
const DB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const STORE_BLOBS = 'blobs';
const STORE_HANDLES = 'handles';
const FOLDER_HANDLE_KEY = 'device_music_folder';

export interface FileSystemDirectoryHandleLike {
  name: string;
  kind: 'directory';
  values: () => AsyncIterable<FileSystemHandleLike>;
  queryPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

export type FileSystemHandleLike =
  | FileSystemDirectoryHandleLike
  | {
      name: string;
      kind: 'file';
      getFile: () => Promise<File>;
    };

const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|opus|flac|webm|3gp|mp4a|oga)$/i;

export function isAudioFileCandidate(file: { name: string; type?: string }): boolean {
  if (file.type && file.type.toLowerCase().startsWith('audio/')) return true;
  return AUDIO_EXT_RE.test(file.name);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline music DB.'));
  });
}

export async function getAllOfflineTracks(): Promise<OfflineTrack[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readonly');
    const store = tx.objectStore(STORE_TRACKS);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result as OfflineTrack[] | undefined) ?? [];
      list.sort((a, b) => b.addedAt - a.addedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error || new Error('Failed to read offline tracks.'));
  });
}

export async function getOfflineTrackBlob(trackId: string): Promise<Blob | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).get(trackId);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error || new Error('Failed to read audio blob.'));
  });
}

export async function putOfflineTrackWithBlob(track: OfflineTrack, blob: Blob): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_TRACKS).put(track);
    tx.objectStore(STORE_BLOBS).put(blob, track.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save offline track.'));
  });
}

export async function deleteOfflineTrackFromDb(trackId: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_TRACKS).delete(trackId);
    tx.objectStore(STORE_BLOBS).delete(trackId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(reqError(tx.error));
  });
}

function reqError(err: DOMException | null): Error {
  return err || new Error('IndexedDB operation failed');
}

export async function clearOfflineMusicDb(): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_TRACKS).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(reqError(tx.error));
  });
}

export async function saveDirectoryHandleToDb(handle: FileSystemDirectoryHandleLike): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      tx.objectStore(STORE_HANDLES).put(handle, FOLDER_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(reqError(tx.error));
    });
  } catch {
    // Some browsers cannot structured-clone directory handles; ignore gracefully
  }
}

export async function getDirectoryHandleFromDb(): Promise<FileSystemDirectoryHandleLike | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_HANDLES, 'readonly');
      const req = tx.objectStore(STORE_HANDLES).get(FOLDER_HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandleLike | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function decodeId3TextFrame(bytes: Uint8Array): string {
  if (bytes.length < 2) return '';
  const encoding = bytes[0];
  const payload = bytes.subarray(1);
  try {
    if (encoding === 0) {
      return new TextDecoder('iso-8859-1').decode(payload).replace(/\0/g, '').trim();
    }
    if (encoding === 1 || encoding === 2) {
      return new TextDecoder('utf-16').decode(payload).replace(/\0/g, '').trim();
    }
    return new TextDecoder('utf-8').decode(payload).replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

async function extractId3Tags(blob: Blob): Promise<{ title?: string; artist?: string; album?: string }> {
  try {
    const slice = blob.slice(0, Math.min(blob.size, 131072));
    const buf = new Uint8Array(await slice.arrayBuffer());
    if (buf.length < 10) return {};
    // Check "ID3" header
    if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return {};
    const version = buf[3];
    if (version < 3 || version > 4) return {};

    const tagSize =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);

    let offset = 10;
    const flags = buf[5];
    if ((flags & 0x40) !== 0 && offset + 4 <= buf.length) {
      const extSize =
        version === 4
          ? ((buf[offset] & 0x7f) << 21) |
            ((buf[offset + 1] & 0x7f) << 14) |
            ((buf[offset + 2] & 0x7f) << 7) |
            (buf[offset + 3] & 0x7f)
          : (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      offset += Math.max(4, extSize);
    }

    const limit = Math.min(buf.length, 10 + tagSize);
    const result: { title?: string; artist?: string; album?: string } = {};

    while (offset + 10 <= limit) {
      const frameId = String.fromCharCode(
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3]
      );
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      const frameSize =
        version === 4
          ? ((buf[offset + 4] & 0x7f) << 21) |
            ((buf[offset + 5] & 0x7f) << 14) |
            ((buf[offset + 6] & 0x7f) << 7) |
            (buf[offset + 7] & 0x7f)
          : ((buf[offset + 4] << 24) >>> 0) +
            (buf[offset + 5] << 16) +
            (buf[offset + 6] << 8) +
            buf[offset + 7];

      offset += 10;
      if (frameSize <= 0 || offset + frameSize > limit) break;

      const frameBytes = buf.subarray(offset, offset + frameSize);
      if (frameId === 'TIT2') result.title = decodeId3TextFrame(frameBytes);
      else if (frameId === 'TPE1') result.artist = decodeId3TextFrame(frameBytes);
      else if (frameId === 'TALB') result.album = decodeId3TextFrame(frameBytes);

      if (result.title && result.artist && result.album) break;
      offset += frameSize;
    }

    return result;
  } catch {
    return {};
  }
}

function probeAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(0);
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';

    let settled = false;
    const finish = (secs: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(secs) && secs > 0 ? Math.round(secs) : 0);
    };

    const timer = window.setTimeout(() => finish(0), 2500);
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

function parseFileNameMeta(fileName: string): { title: string; artist: string } {
  const withoutExt = fileName.replace(AUDIO_EXT_RE, '').replace(/_/g, ' ').trim();
  const cleaned = withoutExt
    .replace(/\b(320\s*kbps|192\s*kbps|128\s*kbps|mp3|download|pagalworld|pendujatt|mr-?jatt|djpunjab)\b/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const dashIdx = cleaned.indexOf(' - ');
  if (dashIdx > 1 && dashIdx < cleaned.length - 3) {
    const left = cleaned.slice(0, dashIdx).trim();
    const right = cleaned.slice(dashIdx + 3).trim();
    return { artist: left, title: right };
  }

  return {
    title: cleaned || withoutExt || 'Audio Track',
    artist: 'Downloaded Music',
  };
}

export function buildLocalTrackStableId(fileName: string, sizeBytes: number, relativePath?: string): string {
  const raw = `${relativePath || fileName}::${sizeBytes}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `loc_${(hash >>> 0).toString(36)}_${sizeBytes.toString(36)}`;
}

export async function createOfflineTrackFromFile(
  file: File,
  source: 'device-folder' | 'device-file',
  relativePath?: string
): Promise<{ track: OfflineTrack; blob: Blob }> {
  const [id3, durationSeconds] = await Promise.all([
    extractId3Tags(file),
    probeAudioDuration(file),
  ]);
  const fallback = parseFileNameMeta(file.name);

  const track: OfflineTrack = {
    id: buildLocalTrackStableId(file.name, file.size, relativePath),
    title: id3.title || fallback.title,
    artist: id3.artist || fallback.artist,
    album: id3.album || undefined,
    duration: durationSeconds > 0 ? formatSeconds(durationSeconds) : '--:--',
    durationSeconds,
    fileName: file.name,
    mimeType: file.type || 'audio/mpeg',
    sizeBytes: file.size,
    source,
    addedAt: Date.now(),
    relativePath,
  };

  return { track, blob: file };
}

async function fetchImageAsDataUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (blob.size > 512 * 1024) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export interface AudioDownloadProgress {
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  remainingBytes: number;
}

function getExtensionFromContentType(contentType: string, fallbackUrlOrName = ''): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('flac')) return 'flac';
  if (ct.includes('aac')) return 'aac';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mp4') || ct.includes('m4a')) return 'm4a';
  const m = fallbackUrlOrName.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  if (m && AUDIO_EXT_RE.test(`.${m[1]}`)) return m[1].toLowerCase();
  return 'm4a';
}

export function triggerDeviceFileDownload(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined') return;
  const cleanName = fileName.replace(/[\\/:*?"<>|]/g, '').trim() || 'vibra-song.m4a';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = cleanName;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, 4000);
}

export async function exportOfflineTrackToDevice(track: OfflineTrack): Promise<void> {
  const blob = await getOfflineTrackBlob(track.id);
  if (!blob) {
    throw new Error('Offline audio file could not be found in local storage.');
  }
  triggerDeviceFileDownload(blob, track.fileName);
}

async function fetchAudioBlobWithProgress(
  url: string,
  onProgress?: (p: AudioDownloadProgress) => void
): Promise<{ blob: Blob; contentType: string }> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let errMsg = 'This track could not be downloaded right now.';
    try {
      const json = (await res.json()) as { message?: string };
      if (json.message) errMsg = json.message;
    } catch {
      // ignore non-json
    }
    throw new Error(errMsg);
  }

  const contentType = res.headers.get('content-type') || 'audio/mp4';
  const totalBytes = Number(res.headers.get('content-length')) || 0;

  if (!res.body) {
    const blob = await res.blob();
    onProgress?.({
      percent: 100,
      loadedBytes: blob.size,
      totalBytes: blob.size,
      remainingBytes: 0,
    });
    return { blob, contentType };
  }

  const reader = res.body.getReader();
  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  let loadedBytes = 0;
  let lastReportTs = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy);
      loadedBytes += value.byteLength;

      const now = Date.now();
      if (now - lastReportTs >= 90) {
        lastReportTs = now;
        if (totalBytes > 0) {
          const percent = Math.min(99, Math.round((loadedBytes / totalBytes) * 100));
          onProgress?.({
            percent,
            loadedBytes,
            totalBytes,
            remainingBytes: Math.max(0, totalBytes - loadedBytes),
          });
        } else {
          const estPct = Math.min(92, Math.round((1 - Math.exp(-loadedBytes / (2.4 * 1024 * 1024))) * 92));
          onProgress?.({
            percent: Math.max(5, estPct),
            loadedBytes,
            totalBytes: 0,
            remainingBytes: 0,
          });
        }
      }
    }
  }

  const finalType = contentType.startsWith('audio/') ? contentType : 'audio/mp4';
  const blob = new Blob(chunks, { type: finalType });
  if (blob.size < 16384) {
    throw new Error('Downloaded audio file was incomplete.');
  }

  const finalTotal = totalBytes > 0 ? Math.max(totalBytes, blob.size) : blob.size;
  onProgress?.({
    percent: 100,
    loadedBytes: blob.size,
    totalBytes: finalTotal,
    remainingBytes: 0,
  });

  return { blob, contentType: finalType };
}

export async function saveOnlineTrackOffline(
  track: Track,
  options?: {
    alsoDownloadToDevice?: boolean;
    onProgress?: (p: AudioDownloadProgress) => void;
  }
): Promise<OfflineTrack> {
  const qs = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
    duration: String(track.durationSeconds || 0),
  });
  const { blob, contentType } = await fetchAudioBlobWithProgress(
    `/api/audio/stream?${qs.toString()}`,
    options?.onProgress
  );

  const ext = getExtensionFromContentType(contentType);
  const [measuredDur, artworkDataUrl] = await Promise.all([
    probeAudioDuration(blob),
    fetchImageAsDataUrl(track.thumbnailHigh || track.thumbnail),
  ]);

  const durSec = measuredDur > 0 ? measuredDur : track.durationSeconds || 0;
  const cleanTitle = track.title.replace(/[^\w\s-]/g, '').trim().slice(0, 50) || track.id;
  const cleanArtist = track.artist.replace(/[^\w\s-]/g, '').trim().slice(0, 30);
  const safeName = cleanArtist ? `${cleanTitle} - ${cleanArtist}.${ext}` : `${cleanTitle}.${ext}`;

  const offlineTrack: OfflineTrack = {
    id: `dl_${track.id}`,
    title: track.title,
    artist: track.artist,
    album: 'Downloaded via VIBRA',
    duration: durSec > 0 ? formatSeconds(durSec) : track.duration || '--:--',
    durationSeconds: durSec,
    fileName: safeName,
    mimeType: blob.type || contentType || 'audio/mp4',
    sizeBytes: blob.size,
    source: 'saved-online',
    addedAt: Date.now(),
    artworkDataUrl,
    sourceVideoId: track.id,
  };

  await putOfflineTrackWithBlob(offlineTrack, blob);

  if (options?.alsoDownloadToDevice) {
    triggerDeviceFileDownload(blob, safeName);
  }

  return offlineTrack;
}

export async function saveDirectAudioUrlOffline(
  rawUrl: string,
  options?: {
    title?: string;
    artist?: string;
    alsoDownloadToDevice?: boolean;
    onProgress?: (p: AudioDownloadProgress) => void;
  }
): Promise<OfflineTrack> {
  const { blob, contentType } = await fetchAudioBlobWithProgress(
    `/api/audio/fetch-url?url=${encodeURIComponent(rawUrl.trim())}`,
    options?.onProgress
  );

  const ext = getExtensionFromContentType(contentType, rawUrl);
  const urlObj = new URL(rawUrl.trim());
  const rawBaseName = decodeURIComponent(urlObj.pathname.split('/').pop() || `track.${ext}`);
  const fileNameGuess = AUDIO_EXT_RE.test(rawBaseName) ? rawBaseName : `${rawBaseName}.${ext}`;

  const [id3, measuredDur] = await Promise.all([extractId3Tags(blob), probeAudioDuration(blob)]);
  const parsedName = parseFileNameMeta(fileNameGuess);

  const finalTitle = options?.title?.trim() || id3.title || parsedName.title;
  const finalArtist = options?.artist?.trim() || id3.artist || parsedName.artist || urlObj.hostname;
  const safeName = `${finalTitle.replace(/[^\w\s-]/g, '').trim().slice(0, 50) || 'audio-track'}.${ext}`;

  const offlineTrack: OfflineTrack = {
    id: buildLocalTrackStableId(safeName, blob.size, rawUrl.trim()),
    title: finalTitle,
    artist: finalArtist,
    album: id3.album || 'Imported from Web Link',
    duration: measuredDur > 0 ? formatSeconds(measuredDur) : '--:--',
    durationSeconds: measuredDur,
    fileName: safeName,
    mimeType: blob.type || contentType || 'audio/mpeg',
    sizeBytes: blob.size,
    source: 'direct-url',
    addedAt: Date.now(),
  };

  await putOfflineTrackWithBlob(offlineTrack, blob);

  if (options?.alsoDownloadToDevice) {
    triggerDeviceFileDownload(blob, safeName);
  }

  return offlineTrack;
}

export async function scanDirectoryHandleRecursively(
  dirHandle: FileSystemDirectoryHandleLike,
  prefix = '',
  maxFiles = 400
): Promise<Array<{ file: File; relativePath: string }>> {
  const collected: Array<{ file: File; relativePath: string }> = [];

  async function walk(handle: FileSystemDirectoryHandleLike, pathPrefix: string) {
    for await (const entry of handle.values()) {
      if (collected.length >= maxFiles) return;
      const entryPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      if (entry.kind === 'file') {
        if (isAudioFileCandidate({ name: entry.name })) {
          try {
            const file = await entry.getFile();
            if (file.size > 4096) {
              collected.push({ file, relativePath: entryPath });
            }
          } catch {
            // skip unreadable file
          }
        }
      } else if (entry.kind === 'directory') {
        await walk(entry, entryPath);
      }
    }
  }

  await walk(dirHandle, prefix);
  return collected;
}
