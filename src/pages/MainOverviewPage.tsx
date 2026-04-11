import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { VISIBLE_HEIGHT, VISIBLE_WIDTH } from '../viewportConstants';
import '../app.css';
import '../theme/fonts.css';

const TRACK_URLS: string[] = Array.from({ length: 8 }, (_, i) =>
  new URL(`../assets/fonts/audio/track${i + 1}.mp3`, import.meta.url).href
);

const BPM = 120;
const BEATS_PER_BAR = 4;
const PIXELS_PER_BEAT = 40;
const PIXELS_PER_SECOND = (BPM / 60) * PIXELS_PER_BEAT; // 80 px/s
const SONG_DURATION_SEC = 70;
const SONG_WORLD_WIDTH = Math.round(SONG_DURATION_SEC * PIXELS_PER_SECOND);
const BAR_PITCH = 4;
const COLUMN_COUNT = Math.floor(SONG_WORLD_WIDTH / BAR_PITCH);
const CURSOR_X = Math.floor(VISIBLE_WIDTH / 2);

// Layout zones (total: 400px)
const CMD_ENCODER_SLOT_COUNT = 8;
/** Center X of CMD-bar encoder slot i (0..7); matches hardware encoder positions */
const cmdEncoderSlotCenterX = (slotIndex: number, canvasW: number = VISIBLE_WIDTH) =>
  (slotIndex + 0.5) * (canvasW / CMD_ENCODER_SLOT_COUNT);
const CMD_BAR_H = 25;   // top command bar
const GRID_H = 24;      // time-division grid (beat/bar ticks)
const BOTTOM_BAR_H = 26; // bottom status bar
const TRACK_COUNT = 8;
const TRACK_H = Math.floor((VISIBLE_HEIGHT - CMD_BAR_H - GRID_H - BOTTOM_BAR_H) / TRACK_COUNT); // 40
const TRACKS_Y0 = CMD_BAR_H + GRID_H; // 49
const BOTTOM_BAR_Y = VISIBLE_HEIGHT - BOTTOM_BAR_H; // 374

const COLOR_LANE_BG = '#0d2818';
const COLOR_CMD_BAR_BG = '#061208';
const COLOR_WAVE_NORMAL = '#f8f8f2';
const COLOR_WAVE_SELECTED = '#a6e22e';
const COLOR_WAVE_MUTED = '#75715e';
const COLOR_WAVE_MUTED_SEL = '#668c1c';
const COLOR_CURSOR = '#7fffff';
const COLOR_LOOP_SELECTION = 'rgba(106, 142, 31, 0.5)';
const COLOR_LOOP_SELECTION_MARKER = '#ffa034';
const COLOR_SEGMENT_SELECTION = 'rgba(255, 150, 30, 0.15)';
const COLOR_CLIP_SELECTION = 'rgba(127, 255, 255, 0.27)';
const COLOR_CLIP_SELECTION_MARKER = '#7fffff';
const COLOR_SYNC_UPCOMING_MARKER = '#ffaa00';
const COLOR_TRIANGLE = '#ffa034';
const COLOR_TICK_BEAT = '#6a9aaa';
const COLOR_TICK_BAR = '#9ec8d8';
const COLOR_LABEL_UNMUTED = '#ffaa00';
const COLOR_LABEL_MUTED = '#664400';
const COLOR_CMD_TEXT = '#ffa034';
const COLOR_BOTTOM_SQUARE = '#664400';
const COLOR_BOTTOM_SQUARE_FILLED = '#ffaa00';
const BLINK_HZ = 4;
const REJECT_BLINK_HZ = 11;
const TIMELINE_DRAG_THRESHOLD_PX = 6;

// Clipboard Speed modifier — musical ratios (index 3 = x1.0 neutral)
const CB_SPEED_RATIOS: readonly number[] = [1 / 3, 0.5, 0.75, 1.0, 4 / 3, 1.5, 1.75, 2.0];
const CB_SPEED_NEUTRAL_IDX = 3;

// 8 minutes combined audio budget (in seconds * tracks)
const UNDO_BUDGET_SEC = 480;
const ERROR_COPY_MAX_LENGTH_MSG =
  'ERROR Maximum Copy length : 8 minutes (combined).';
const TRANSIENT_TOAST_MS = 1700;
const COMMAND_TOAST_MS = 800;

type TransientToastPayload = { message: string; variant: 'error' | 'success' };

type StepDivision = '4/1' | '2/1' | '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/64';
const STEP_DIVISIONS: StepDivision[] = [
  '4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64',
];

// Keep full union types so sync-logic helpers remain type-safe
type SyncMuteMode = 'OFF' | 'BEAT' | 'BAR' | 'BARS4' | 'BARS8' | 'MARKER';
type SyncInteractionMode = 'SIMPLE' | 'QUEUED';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function beatDurationSec(): number { return 60 / BPM; }
function barDurationSec(): number { return beatDurationSec() * BEATS_PER_BAR; }

function stepDivisionToSec(div: StepDivision): number {
  const b = barDurationSec();
  const map: Record<StepDivision, number> = {
    '4/1': b * 4, '2/1': b * 2, '1/1': b,
    '1/2': b / 2, '1/4': b / 4, '1/8': b / 8,
    '1/16': b / 16, '1/32': b / 32, '1/64': b / 64,
  };
  return map[div];
}

function snapToStepDivision(t: number, div: StepDivision): number {
  const step = stepDivisionToSec(div);
  const s = Math.round(t / step) * step;
  return Math.min(Math.max(0, s), SONG_DURATION_SEC - 1e-6);
}

function nextSyncBoundarySongSec(currentSongSec: number, mode: SyncMuteMode): number {
  if (mode === 'OFF' || mode === 'MARKER') return currentSongSec;
  const beatDur = beatDurationSec();
  const barDur = barDurationSec();
  const divisor =
    mode === 'BEAT' ? beatDur :
    mode === 'BAR'  ? barDur :
    mode === 'BARS4' ? barDur * 4 : barDur * 8;
  const n = Math.ceil((currentSongSec + 1e-6) / divisor) * divisor;
  return n >= SONG_DURATION_SEC - 1e-9 ? SONG_DURATION_SEC : n;
}

function stepToNextMarkerLinear(
  pos: number,
  sorted: number[]
): { target: number; delta: number } | null {
  const eps = 1e-6;
  for (const m of sorted) {
    if (m > pos + eps && m < SONG_DURATION_SEC - eps)
      return { target: m, delta: m - pos };
  }
  return null;
}

function deltaSecToNextBoundary(
  songNow: number,
  mode: SyncMuteMode,
  sortedMarkers: number[]
): number {
  if (mode === 'OFF') return Infinity;
  if (mode === 'MARKER') {
    const markers = sortedMarkers.length > 0 ? sortedMarkers : [0];
    const step = stepToNextMarkerLinear(songNow, markers);
    return step === null ? Infinity : Math.max(1e-4, step.delta);
  }
  let b = nextSyncBoundarySongSec(songNow, mode);
  let d = b - songNow;
  if (d <= 1e-5) { b = nextSyncBoundarySongSec(songNow + 1e-3, mode); d = b - songNow; }
  return Math.max(1e-4, d);
}

function getAllMarkersSorted(userMarkerSongSec: number[]): number[] {
  const u = userMarkerSongSec.filter((t) => t > 1e-6 && t < SONG_DURATION_SEC - 1e-6);
  const set = new Set<number>([0, ...u]);
  return Array.from(set).sort((a, b) => a - b);
}

function getCurrentSection(
  playheadSec: number,
  userMarkers: number[],
  songEndSec: number
): { startSec: number; endSec: number } {
  const sorted = [...getAllMarkersSorted(userMarkers), songEndSec];
  let startSec = 0;
  let endSec = songEndSec;
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i]!;
    if (m <= playheadSec + 1e-6) startSec = m;
    if (m > playheadSec + 1e-6) { endSec = m; break; }
  }
  return { startSec, endSec };
}

function computeSafeSyncApply(
  songNow: number,
  mode: SyncMuteMode,
  sortedMarkers: number[]
): { deltaPlayback: number; boundarySongSec: number } | null {
  if (mode === 'OFF') return { deltaPlayback: Infinity, boundarySongSec: songNow };
  if (mode === 'MARKER') {
    const markers = sortedMarkers.length > 0 ? sortedMarkers : [0];
    const minLead = beatDurationSec();
    let pos = songNow;
    let total = 0;
    for (let i = 0; i < 256; i++) {
      const step = stepToNextMarkerLinear(pos, markers);
      if (step === null) return null;
      const { target, delta } = step;
      if (delta <= 1e-12) return null;
      total += delta;
      if (total >= minLead - 1e-6) {
        const boundarySongSec = target >= SONG_DURATION_SEC - 1e-9 ? SONG_DURATION_SEC : target;
        return { deltaPlayback: total, boundarySongSec };
      }
      pos = target + 1e-3;
      if (pos >= SONG_DURATION_SEC - 1e-9) return null;
    }
    return null;
  }
  const minLead = beatDurationSec();
  let pos = songNow;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    let b = nextSyncBoundarySongSec(pos, mode);
    let d = b - pos;
    if (d <= 1e-6) { b = nextSyncBoundarySongSec(pos + 1e-3, mode); d = b - pos; }
    total += d;
    if (total >= minLead - 1e-6) {
      const boundarySongSec = b >= SONG_DURATION_SEC - 1e-9 ? SONG_DURATION_SEC : b;
      return { deltaPlayback: total, boundarySongSec };
    }
    pos = b + 1e-3;
    if (pos >= SONG_DURATION_SEC) pos -= SONG_DURATION_SEC;
  }
  const fallback = deltaSecToNextBoundary(songNow, mode, sortedMarkers);
  const fb = nextSyncBoundarySongSec(songNow, mode);
  return { deltaPlayback: fallback, boundarySongSec: fb >= SONG_DURATION_SEC - 1e-9 ? SONG_DURATION_SEC : fb };
}

function viewportClientXToLogical(canvas: HTMLCanvasElement, clientX: number): number {
  const r = canvas.getBoundingClientRect();
  return ((clientX - r.left) / r.width) * VISIBLE_WIDTH;
}

function logicalXToSongSec(scrollX: number, lx: number): number {
  const worldPx = scrollX + lx;
  let t = worldPx / PIXELS_PER_SECOND;
  t = ((t % SONG_DURATION_SEC) + SONG_DURATION_SEC) % SONG_DURATION_SEC;
  return t;
}

function hitTestTimelineMarker(
  lx: number,
  scrollX: number,
  userMarkerSongSec: number[]
): { hit: 'zero' | 'user' | 'none'; songSec?: number } {
  const sorted = getAllMarkersSorted(userMarkerSongSec);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i]!;
    const mx = m * PIXELS_PER_SECOND - scrollX;
    if (Math.abs(lx - mx) <= 10) {
      if (m <= 1e-6) return { hit: 'zero' };
      return { hit: 'user', songSec: m };
    }
  }
  return { hit: 'none' };
}

function playbackSecondsToBoundary(fromSongSec: number, boundarySongSec: number): number {
  const eps = 1e-6;
  if (boundarySongSec >= SONG_DURATION_SEC - eps) {
    if (fromSongSec <= boundarySongSec + eps) return Math.max(0, boundarySongSec - fromSongSec);
    return SONG_DURATION_SEC - fromSongSec;
  }
  if (boundarySongSec >= fromSongSec - eps) return Math.max(0, boundarySongSec - fromSongSec);
  return SONG_DURATION_SEC - fromSongSec + boundarySongSec;
}

function computeAmplitudes(buffer: AudioBuffer, columns: number): number[] {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const total = buffer.length;
  const out: number[] = [];
  for (let col = 0; col < columns; col++) {
    const start = Math.floor((col / columns) * total);
    const end = Math.floor(((col + 1) / columns) * total);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const m = (Math.abs(ch0[i] ?? 0) + Math.abs(ch1[i] ?? 0)) * 0.5;
      if (m > peak) peak = m;
    }
    out.push(Math.min(1, Math.max(0.02, peak * 1.15)));
  }
  return out;
}

function isShiftCode(code: string): boolean {
  return code === 'ShiftLeft' || code === 'ShiftRight';
}

function buildClipboardBuffers(clip: ClipboardData, ctx: AudioContext): AudioBuffer[] {
  const buffers: AudioBuffer[] = [];
  for (let i = 0; i < TRACK_COUNT; i++) {
    const channels = clip.tracks.get(i);
    const numChannels = channels ? channels.length : 1;
    const length = channels
      ? channels[0]!.length
      : Math.ceil(clip.durationSec * clip.sampleRate);
    const buf = ctx.createBuffer(numChannels, Math.max(1, length), clip.sampleRate);
    if (channels) {
      for (let ch = 0; ch < channels.length; ch++) {
        buf.copyToChannel(channels[ch]! as Float32Array, ch);
      }
    }
    buffers.push(buf);
  }
  return buffers;
}

function computeClipboardColumnCount(durationSec: number): number {
  return Math.max(1, Math.floor(durationSec * PIXELS_PER_SECOND / BAR_PITCH));
}

// ---------------------------------------------------------------------------
// Audio manipulation helpers (pure, operate on AudioBuffer channel data)
// ---------------------------------------------------------------------------

function extractAudioSection(buffer: AudioBuffer, startSec: number, endSec: number): Float32Array[] {
  const sr = buffer.sampleRate;
  const startSample = Math.floor(startSec * sr);
  const endSample = Math.min(buffer.length, Math.floor(endSec * sr));
  const len = Math.max(0, endSample - startSample);
  const result: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const out = new Float32Array(len);
    out.set(src.subarray(startSample, startSample + len));
    result.push(out);
  }
  return result;
}

function silenceAudioSection(buffer: AudioBuffer, startSec: number, endSec: number): void {
  const sr = buffer.sampleRate;
  const startSample = Math.floor(startSec * sr);
  const endSample = Math.min(buffer.length, Math.floor(endSec * sr));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    data.fill(0, startSample, endSample);
  }
}

function overwriteAudioSection(buffer: AudioBuffer, startSec: number, channelData: Float32Array[]): void {
  const sr = buffer.sampleRate;
  const startSample = Math.floor(startSec * sr);
  for (let ch = 0; ch < Math.min(buffer.numberOfChannels, channelData.length); ch++) {
    const dest = buffer.getChannelData(ch);
    const src = channelData[ch]!;
    const len = Math.min(src.length, dest.length - startSample);
    if (len > 0) dest.set(src.subarray(0, len), startSample);
  }
}

// ---------------------------------------------------------------------------
// Clipboard modifier helper
// ---------------------------------------------------------------------------

function getClipboardTargets(
  s: {
    clipboardSelectedTracks: boolean[];
    clipboardSelection: { startSec: number; endSec: number } | null;
    clipboardDurationSec: number;
  },
  clip: { tracks: Map<number, Float32Array[]> }
): { targetTracks: number[]; startSec: number; endSec: number } {
  const anySelected = s.clipboardSelectedTracks.some(Boolean);
  const targetTracks: number[] = anySelected
    ? s.clipboardSelectedTracks.reduce<number[]>((acc, sel, i) => { if (sel) acc.push(i); return acc; }, [])
    : Array.from({ length: 8 }, (_, i) => i).filter(i => clip.tracks.has(i));
  const hasSel =
    s.clipboardSelection !== null &&
    s.clipboardSelection.endSec > s.clipboardSelection.startSec + 1e-4;
  const startSec = hasSel ? s.clipboardSelection!.startSec : 0;
  const endSec   = hasSel ? s.clipboardSelection!.endSec   : s.clipboardDurationSec;
  return { targetTracks, startSec, endSec };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingSyncEntry {
  targetMuted: boolean;
  boundarySongSec: number;
  applyAtAudioTime: number | null;
}

interface ClipboardData {
  // trackIndex -> per-channel Float32Array
  tracks: Map<number, Float32Array[]>;
  sampleRate: number;
  durationSec: number;
}

interface UndoRestoration {
  trackIndex: number;
  startSample: number;
  channels: Float32Array[];
}

interface UndoEntry {
  type: 'cut' | 'paste';
  restorations: UndoRestoration[];
  durationSec: number;
  sampleRate: number;
}

interface LoopSelection {
  startSec: number;
  endSec: number;
}

interface DrawState {
  songSec: number;
  playing: boolean;
  muted: boolean[];
  selectedTrack: number;
  pending: Map<number, PendingSyncEntry>;
  syncMuteMode: SyncMuteMode;
  syncInteractionMode: SyncInteractionMode;
  shiftDown: boolean;
  userMarkerSongSec: number[];
  amplitudes: number[][] | null;
  loadError: string | null;
  stepDivision: StepDivision;
  loopSelection: LoopSelection | null;
  // Clipboard Overview Mode
  clipboardMode: boolean;
  clipboardSongSec: number;
  clipboardPlaying: boolean;
  clipboardSelectedTracks: boolean[];
  clipboardSelection: LoopSelection | null;
  clipboardAmplitudes: number[][] | null;
  clipboardColumnCount: number;
  clipboardDurationSec: number;
  cbModVolDb: number;
  cbModPan: number;
  cbModSpeedIdx: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MainOverviewPage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<AudioBuffer[] | null>(null);
  const gainNodesRef = useRef<GainNode[] | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[] | null>(null);
  const rafRef = useRef<number | null>(null);
  const anchorAudioTimeRef = useRef(0);
  const anchorSongSecRef = useRef(0);

  const clipboardRef = useRef<ClipboardData | null>(null);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoEntryRef = useRef<UndoEntry | null>(null);

  // Clipboard Overview Mode audio refs
  const clipboardBuffersRef = useRef<AudioBuffer[] | null>(null);
  const clipboardSourcesRef = useRef<AudioBufferSourceNode[] | null>(null);
  const clipboardGainNodesRef = useRef<GainNode[] | null>(null);
  const clipboardAnchorAudioTimeRef = useRef(0);
  const clipboardAnchorSongSecRef = useRef(0);
  // Internal clipboard for CUT/COPY/PASTE within Clipboard Overview (never crosses back to main clipboard)
  const cbInternalClipRef = useRef<ClipboardData | null>(null);
  // Drag state for VOL/PAN modifier knobs in the CMD bar
  const cbModDragRef = useRef<{
    pointerId: number;
    slot: number; // 1 = VOL (index 1), 2 = PAN (index 2)
    startClientX: number;
    startValue: number;
  } | null>(null);

  const stateRef = useRef<DrawState>({
    songSec: 0,
    playing: false,
    // Tracks 1–8: default muted 1,4,5,7,8 (indices 0,3,4,6,7); audible 2,3,6
    muted: [true, false, false, true, true, false, true, true],
    selectedTrack: 0,
    pending: new Map(),
    syncMuteMode: 'BAR',      // fixed for this view
    syncInteractionMode: 'SIMPLE', // fixed for this view
    shiftDown: false,
    userMarkerSongSec: [],
    amplitudes: null,
    loadError: null,
    stepDivision: '1/4',
    loopSelection: null,
    // Clipboard Overview Mode
    clipboardMode: false,
    clipboardSongSec: 0,
    clipboardPlaying: false,
    clipboardSelectedTracks: Array(TRACK_COUNT).fill(false),
    clipboardSelection: null,
    clipboardAmplitudes: null,
    clipboardColumnCount: 0,
    clipboardDurationSec: 0,
    cbModVolDb: 0,
    cbModPan: 0,
    cbModSpeedIdx: CB_SPEED_NEUTRAL_IDX,
  });

  const [uiTick, setUiTick] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [transientToast, setTransientToast] = useState<TransientToastPayload | null>(null);
  const transientToastTimerRef = useRef<number>(0);

  const rejectBlinkEndMsRef = useRef(0);
  const rejectBlinkTracksRef = useRef<Set<number>>(new Set());
  // Debounced shift-release timer: Windows fires a phantom ShiftLeft keyup when
  // Shift+Numpad is pressed (NumLock toggle). We delay the shiftDown reset and
  // cancel it if a Numpad keydown arrives within the window.
  const shiftResetTimerRef = useRef<number>(0);

  const markerDragGhostSecRef = useRef<number | null>(null);
  const markerDragSourceSecRef = useRef<number | null>(null);
  const prevSongSecRef = useRef<number>(-Infinity);
  const timelinePointerRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    kind: 'empty' | 'userMarker';
    sourceSec?: number;
    dragActive: boolean;
  } | null>(null);

  const bumpUi = useCallback(() => setUiTick((t) => t + 1), []);

  const showTransientToast = useCallback(
    (
      message: string,
      options?: Partial<{ durationMs: number; variant: 'error' | 'success' }>
    ) => {
      const durationMs = options?.durationMs ?? TRANSIENT_TOAST_MS;
      const variant = options?.variant ?? 'error';
      clearTimeout(transientToastTimerRef.current);
      setTransientToast({ message, variant });
      transientToastTimerRef.current = window.setTimeout(() => {
        setTransientToast(null);
      }, durationMs);
    },
    []
  );

  useEffect(() => {
    return () => clearTimeout(transientToastTimerRef.current);
  }, []);

  const triggerRejectBlink = useCallback(
    (trackIndices: number[]) => {
      rejectBlinkTracksRef.current = new Set(trackIndices);
      rejectBlinkEndMsRef.current = performance.now() + 450;
      bumpUi();
    },
    [bumpUi]
  );

  const getSongSecNow = useCallback((): number => {
    const s = stateRef.current;
    if (!s.playing) return s.songSec;
    const ctx = audioCtxRef.current;
    if (!ctx) return s.songSec;
    const elapsed = ctx.currentTime - anchorAudioTimeRef.current;
    let pos = anchorSongSecRef.current + elapsed;
    while (pos >= SONG_DURATION_SEC) pos -= SONG_DURATION_SEC;
    while (pos < 0) pos += SONG_DURATION_SEC;
    return pos;
  }, []);

  const scrollXFromSongSec = (sec: number): number => sec * PIXELS_PER_SECOND - CURSOR_X;

  const stopAllSources = useCallback(() => {
    const srcs = sourcesRef.current;
    if (!srcs) return;
    for (const src of srcs) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    sourcesRef.current = null;
  }, []);

  const applyGainImmediate = useCallback((trackIndex: number, muted: boolean) => {
    const gains = gainNodesRef.current;
    const ctx = audioCtxRef.current;
    if (!gains?.[trackIndex] || !ctx) return;
    const g = gains[trackIndex]!.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.value = muted ? 0 : 1;
  }, []);

  const hydratePendingApplyTimes = useCallback(() => {
    const ctx = audioCtxRef.current;
    const s = stateRef.current;
    if (!ctx || !s.playing || s.pending.size === 0 || s.syncMuteMode === 'OFF') return;
    const songNow = getSongSecNow();
    for (const entry of s.pending.values()) {
      const d = playbackSecondsToBoundary(songNow, entry.boundarySongSec);
      entry.applyAtAudioTime = ctx.currentTime + d;
    }
  }, [getSongSecNow]);

  const startPlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    const buffers = buffersRef.current;
    const gains = gainNodesRef.current;
    if (!ctx || !buffers || !gains) return;
    stopAllSources();
    const startSong = stateRef.current.songSec;
    const when = ctx.currentTime;
    const srcs: AudioBufferSourceNode[] = [];
    for (let i = 0; i < TRACK_COUNT; i++) {
      const buf = buffers[i];
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = Math.min(SONG_DURATION_SEC, buf.duration);
      src.connect(gains[i]!);
      const offset = startSong % buf.duration;
      try { src.start(when, offset); } catch { src.start(when, 0); }
      srcs.push(src);
    }
    sourcesRef.current = srcs;
    anchorAudioTimeRef.current = when;
    anchorSongSecRef.current = startSong;
    stateRef.current.playing = true;
    hydratePendingApplyTimes();
    bumpUi();
  }, [stopAllSources, hydratePendingApplyTimes, bumpUi]);

  const pausePlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    stateRef.current.songSec = getSongSecNow();
    stateRef.current.playing = false;
    stopAllSources();
    // Clear all pending mute entries: stopped = immediate control, no scheduled cues.
    stateRef.current.pending.clear();
    bumpUi();
  }, [getSongSecNow, stopAllSources, bumpUi]);

  // ---------------------------------------------------------------------------
  // Clipboard Overview Mode — Playback
  // ---------------------------------------------------------------------------

  const getClipboardSongSecNow = useCallback((): number => {
    const s = stateRef.current;
    if (!s.clipboardPlaying) return s.clipboardSongSec;
    const ctx = audioCtxRef.current;
    if (!ctx) return s.clipboardSongSec;
    const elapsed = ctx.currentTime - clipboardAnchorAudioTimeRef.current;
    let pos = clipboardAnchorSongSecRef.current + elapsed;
    const dur = s.clipboardDurationSec;
    if (dur > 0) {
      while (pos >= dur) pos -= dur;
      while (pos < 0) pos += dur;
    }
    return pos;
  }, []);

  const stopAllClipboardSources = useCallback(() => {
    const srcs = clipboardSourcesRef.current;
    if (!srcs) return;
    for (const src of srcs) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    clipboardSourcesRef.current = null;
  }, []);

  const startClipboardPlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    const buffers = clipboardBuffersRef.current;
    if (!ctx || !buffers) return;

    // Ensure clipboard gain nodes exist (all gain = 1, no muting)
    if (!clipboardGainNodesRef.current) {
      const gains: GainNode[] = [];
      for (let i = 0; i < TRACK_COUNT; i++) {
        const g = ctx.createGain();
        g.gain.value = 1;
        g.connect(ctx.destination);
        gains.push(g);
      }
      clipboardGainNodesRef.current = gains;
    }
    const gains = clipboardGainNodesRef.current;

    stopAllClipboardSources();
    const startPos = stateRef.current.clipboardSongSec;
    const dur = stateRef.current.clipboardDurationSec;
    const when = ctx.currentTime;
    const srcs: AudioBufferSourceNode[] = [];

    for (let i = 0; i < TRACK_COUNT; i++) {
      const buf = buffers[i];
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = Math.min(dur, buf.duration);
      src.connect(gains[i]!);
      const offset = dur > 0 ? startPos % buf.duration : 0;
      try { src.start(when, offset); } catch { src.start(when, 0); }
      srcs.push(src);
    }

    clipboardSourcesRef.current = srcs;
    clipboardAnchorAudioTimeRef.current = when;
    clipboardAnchorSongSecRef.current = startPos;
    stateRef.current.clipboardPlaying = true;
    bumpUi();
  }, [stopAllClipboardSources, bumpUi]);

  const pauseClipboardPlayback = useCallback(() => {
    stateRef.current.clipboardSongSec = getClipboardSongSecNow();
    stateRef.current.clipboardPlaying = false;
    stopAllClipboardSources();
    bumpUi();
  }, [getClipboardSongSecNow, stopAllClipboardSources, bumpUi]);

  // ---------------------------------------------------------------------------
  // Clipboard Overview Mode — Internal CUT / COPY / PASTE
  // ---------------------------------------------------------------------------

  const recomputeClipboardTrackAmplitudes = useCallback((trackIndex: number) => {
    const bufs = clipboardBuffersRef.current;
    const s = stateRef.current;
    if (!bufs || !s.clipboardAmplitudes) return;
    const buf = bufs[trackIndex];
    if (!buf) return;
    s.clipboardAmplitudes[trackIndex] = computeAmplitudes(buf, s.clipboardColumnCount);
  }, []);

  const handleClipboardCutCopy = useCallback((mode: 'cut' | 'copy') => {
    const clip = clipboardRef.current;
    const bufs = clipboardBuffersRef.current;
    const s = stateRef.current;
    if (!clip || !bufs) return;

    // Determine target tracks: all selected tracks, or all tracks that have audio if none selected
    const anySelected = s.clipboardSelectedTracks.some(Boolean);
    const targetTracks: number[] = anySelected
      ? s.clipboardSelectedTracks.reduce<number[]>((acc, sel, i) => { if (sel) acc.push(i); return acc; }, [])
      : Array.from({ length: TRACK_COUNT }, (_, i) => i).filter(i => clip.tracks.has(i));

    if (targetTracks.length === 0) return;

    // Determine time range: clipboardSelection if active, else full clipboard duration
    const hasSel = s.clipboardSelection !== null && s.clipboardSelection.endSec > s.clipboardSelection.startSec + 1e-4;
    const startSec = hasSel ? s.clipboardSelection!.startSec : 0;
    const endSec   = hasSel ? s.clipboardSelection!.endSec   : s.clipboardDurationSec;
    const durationSec = endSec - startSec;
    if (durationSec <= 0) return;

    const sampleRate = clip.sampleRate;

    if (mode === 'copy') {
      const intTracks = new Map<number, Float32Array[]>();
      for (const ti of targetTracks) {
        const buf = bufs[ti];
        if (!buf) continue;
        intTracks.set(ti, extractAudioSection(buf, startSec, endSec));
      }
      cbInternalClipRef.current = { tracks: intTracks, sampleRate, durationSec };
    } else {
      // CUT: extract into internal clip, silence in AudioBuffer AND in clipboardRef.current.tracks
      const intTracks = new Map<number, Float32Array[]>();
      for (const ti of targetTracks) {
        const buf = bufs[ti];
        if (!buf) continue;
        const extracted = extractAudioSection(buf, startSec, endSec);
        intTracks.set(ti, extracted.map(ch => ch.slice()));
        // Silence the AudioBuffer (for immediate playback reflection)
        silenceAudioSection(buf, startSec, endSec);
        // Sync silence into clipboardRef.current.tracks Float32Arrays
        const cbChannels = clip.tracks.get(ti);
        if (cbChannels) {
          const sr = buf.sampleRate;
          const sStart = Math.floor(startSec * sr);
          const chLen = cbChannels[0]?.length ?? 0;
          const sEnd = Math.min(Math.floor(endSec * sr), chLen);
          for (const ch of cbChannels) {
            ch.fill(0, sStart, sEnd);
          }
          // If the full track was silenced, remove from map so UI reflects "empty"
          if (sStart <= 1 && sEnd >= chLen - 1) {
            clip.tracks.delete(ti);
          }
        }
        recomputeClipboardTrackAmplitudes(ti);
      }
      cbInternalClipRef.current = { tracks: intTracks, sampleRate, durationSec };
    }

    const verb = mode === 'cut' ? 'Cut' : 'Copy';
    let toastMsg = verb;
    if (anySelected && targetTracks.length > 1) {
      toastMsg = hasSel ? `${verb}: all selected (Range)` : `${verb}: all selected`;
    } else if (anySelected && targetTracks.length === 1) {
      toastMsg = hasSel ? `${verb} (Range)` : verb;
    } else if (hasSel) {
      toastMsg = `${verb} (Range)`;
    }
    showTransientToast(toastMsg, { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [recomputeClipboardTrackAmplitudes, bumpUi, showTransientToast]);

  const handleClipboardPaste = useCallback(() => {
    const clip = clipboardRef.current;
    const bufs = clipboardBuffersRef.current;
    const intClip = cbInternalClipRef.current;
    const s = stateRef.current;
    if (!clip || !bufs || !intClip || intClip.tracks.size === 0) return;

    const pasteStartSec = getClipboardSongSecNow();

    // Determine target track mapping:
    // - 1 track in internal clip → paste into first selected track, else use its source track index
    // - Multiple tracks → paste back into their source track indices
    let targetMap: Map<number, Float32Array[]>;
    if (intClip.tracks.size === 1) {
      const [srcTi, srcChannels] = [...intClip.tracks.entries()][0]!;
      const selectedTracks = s.clipboardSelectedTracks
        .reduce<number[]>((acc, sel, i) => { if (sel) acc.push(i); return acc; }, []);
      const destTi = selectedTracks.length > 0 ? selectedTracks[0]! : srcTi;
      targetMap = new Map([[destTi, srcChannels]]);
    } else {
      targetMap = intClip.tracks;
    }

    for (const [ti, srcChannels] of targetMap) {
      const buf = bufs[ti];
      if (!buf) continue;
      // Write into the AudioBuffer for immediate playback
      overwriteAudioSection(buf, pasteStartSec, srcChannels);
      // Sync into clipboardRef.current.tracks Float32Arrays
      const sr = buf.sampleRate;
      const sStart = Math.floor(pasteStartSec * sr);
      const destChannels = clip.tracks.get(ti);
      if (destChannels) {
        // Overwrite existing track channels
        for (let ch = 0; ch < Math.min(destChannels.length, srcChannels.length); ch++) {
          const src = srcChannels[ch]!;
          const dst = destChannels[ch]!;
          const len = Math.min(src.length, dst.length - sStart);
          if (len > 0) dst.set(src.subarray(0, len), sStart);
        }
      } else {
        // Track had no audio before — create new Float32Array channels in clipboardRef
        const numChannels = buf.numberOfChannels;
        const totalSamples = Math.ceil(s.clipboardDurationSec * sr);
        const newChannels: Float32Array[] = Array.from({ length: numChannels }, () => new Float32Array(totalSamples));
        for (let ch = 0; ch < Math.min(numChannels, srcChannels.length); ch++) {
          const src = srcChannels[ch]!;
          const len = Math.min(src.length, totalSamples - sStart);
          if (len > 0) newChannels[ch]!.set(src.subarray(0, len), sStart);
        }
        clip.tracks.set(ti, newChannels);
      }
      recomputeClipboardTrackAmplitudes(ti);
    }

    showTransientToast('Paste', { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [getClipboardSongSecNow, recomputeClipboardTrackAmplitudes, bumpUi, showTransientToast]);

  // ---------------------------------------------------------------------------
  // Clipboard Modifier Actions
  // ---------------------------------------------------------------------------

  const handleClipboardVol = useCallback((db: number) => {
    const clip = clipboardRef.current;
    const bufs = clipboardBuffersRef.current;
    const s = stateRef.current;
    if (!clip || !bufs) return;
    const { targetTracks, startSec, endSec } = getClipboardTargets(s, clip);
    if (targetTracks.length === 0) return;
    const gain = Math.pow(10, db / 20);
    for (const ti of targetTracks) {
      const buf = bufs[ti];
      if (!buf) continue;
      const sr = buf.sampleRate;
      const sStart = Math.floor(startSec * sr);
      const sEnd = Math.min(Math.floor(endSec * sr), buf.length);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = sStart; i < sEnd; i++) data[i]! *= gain;
      }
      const cbChannels = clip.tracks.get(ti);
      if (cbChannels) {
        for (const ch of cbChannels) {
          for (let i = sStart; i < Math.min(sEnd, ch.length); i++) ch[i]! *= gain;
        }
      }
      recomputeClipboardTrackAmplitudes(ti);
    }
    const label = db === 0 ? '0 dB' : `${db} dB`;
    showTransientToast(`Vol: ${label}`, { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [recomputeClipboardTrackAmplitudes, bumpUi, showTransientToast]);

  const handleClipboardPan = useCallback((panValue: number) => {
    const clip = clipboardRef.current;
    const bufs = clipboardBuffersRef.current;
    const s = stateRef.current;
    if (!clip || !bufs) return;
    const { targetTracks, startSec, endSec } = getClipboardTargets(s, clip);
    if (targetTracks.length === 0) return;
    const panNorm = panValue / 100; // -1..1
    // Equal-power pan law
    const leftGain  = Math.cos((panNorm + 1) * Math.PI / 4);
    const rightGain = Math.sin((panNorm + 1) * Math.PI / 4);
    for (const ti of targetTracks) {
      const buf = bufs[ti];
      if (!buf || buf.numberOfChannels < 2) continue; // mono unchanged
      const sr = buf.sampleRate;
      const sStart = Math.floor(startSec * sr);
      const sEnd = Math.min(Math.floor(endSec * sr), buf.length);
      const lData = buf.getChannelData(0);
      const rData = buf.getChannelData(1);
      for (let i = sStart; i < sEnd; i++) {
        const l = lData[i]!;
        const r = rData[i]!;
        lData[i] = l * leftGain;
        rData[i] = r * rightGain;
      }
      const cbChannels = clip.tracks.get(ti);
      if (cbChannels && cbChannels.length >= 2) {
        const cL = cbChannels[0]!;
        const cR = cbChannels[1]!;
        for (let i = sStart; i < Math.min(sEnd, cL.length); i++) {
          const l = cL[i]!;
          const r = cR[i]!;
          cL[i] = l * leftGain;
          cR[i] = r * rightGain;
        }
      }
      recomputeClipboardTrackAmplitudes(ti);
    }
    let panLabel: string;
    if (panValue === 0) panLabel = '0';
    else if (panValue < 0) panLabel = `${Math.abs(panValue)}L`;
    else panLabel = `${panValue}R`;
    showTransientToast(`Pan: ${panLabel}`, { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [recomputeClipboardTrackAmplitudes, bumpUi, showTransientToast]);

  const handleClipboardFade = useCallback((direction: 'in' | 'out') => {
    const clip = clipboardRef.current;
    const bufs = clipboardBuffersRef.current;
    const s = stateRef.current;
    if (!clip || !bufs) return;
    const { targetTracks, startSec, endSec } = getClipboardTargets(s, clip);
    if (targetTracks.length === 0) return;
    for (const ti of targetTracks) {
      const buf = bufs[ti];
      if (!buf) continue;
      const sr = buf.sampleRate;
      const sStart = Math.floor(startSec * sr);
      const sEnd = Math.min(Math.floor(endSec * sr), buf.length);
      const len = sEnd - sStart;
      if (len <= 0) continue;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = sStart; i < sEnd; i++) {
          const t = (i - sStart) / len;
          data[i]! *= direction === 'out' ? (1 - t) : t;
        }
      }
      const cbChannels = clip.tracks.get(ti);
      if (cbChannels) {
        for (const ch of cbChannels) {
          for (let i = sStart; i < Math.min(sEnd, ch.length); i++) {
            const t = (i - sStart) / len;
            ch[i]! *= direction === 'out' ? (1 - t) : t;
          }
        }
      }
      recomputeClipboardTrackAmplitudes(ti);
    }
    showTransientToast(direction === 'out' ? 'Fade Out' : 'Fade In', { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [recomputeClipboardTrackAmplitudes, bumpUi, showTransientToast]);

  const handleClipboardReverse = useCallback(() => {
    const clip = clipboardRef.current;
    const bufs = clipboardBuffersRef.current;
    const s = stateRef.current;
    if (!clip || !bufs) return;
    const { targetTracks, startSec, endSec } = getClipboardTargets(s, clip);
    if (targetTracks.length === 0) return;
    for (const ti of targetTracks) {
      const buf = bufs[ti];
      if (!buf) continue;
      const sr = buf.sampleRate;
      const sStart = Math.floor(startSec * sr);
      const sEnd = Math.min(Math.floor(endSec * sr), buf.length);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const data = buf.getChannelData(ch);
        let lo = sStart, hi = sEnd - 1;
        while (lo < hi) {
          const tmp = data[lo]!; data[lo] = data[hi]!; data[hi] = tmp;
          lo++; hi--;
        }
      }
      const cbChannels = clip.tracks.get(ti);
      if (cbChannels) {
        for (const ch of cbChannels) {
          let lo = sStart, hi = Math.min(sEnd, ch.length) - 1;
          while (lo < hi) {
            const tmp = ch[lo]!; ch[lo] = ch[hi]!; ch[hi] = tmp;
            lo++; hi--;
          }
        }
      }
      recomputeClipboardTrackAmplitudes(ti);
    }
    showTransientToast('Reverse', { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [recomputeClipboardTrackAmplitudes, bumpUi, showTransientToast]);

  const handleClipboardSpeed = useCallback((speedIdx: number) => {
    if (speedIdx === CB_SPEED_NEUTRAL_IDX) return;
    const clip = clipboardRef.current;
    const bufs = clipboardBuffersRef.current;
    const s = stateRef.current;
    const ctx = audioCtxRef.current;
    if (!clip || !bufs || !ctx) return;
    const { targetTracks, startSec, endSec } = getClipboardTargets(s, clip);
    if (targetTracks.length === 0) return;

    const ratio = CB_SPEED_RATIOS[speedIdx]!;

    for (const ti of targetTracks) {
      const buf = bufs[ti];
      if (!buf) continue;
      const sr = buf.sampleRate;
      const sStart = Math.floor(startSec * sr);
      const sEnd = Math.min(Math.floor(endSec * sr), buf.length);
      const srcLen = sEnd - sStart;
      if (srcLen <= 0) continue;
      const dstLen = Math.max(1, Math.round(srcLen / ratio));
      const newTotalLen = buf.length - srcLen + dstLen;
      const numCh = buf.numberOfChannels;
      const newBuf = ctx.createBuffer(numCh, newTotalLen, sr);

      for (let ch = 0; ch < numCh; ch++) {
        const srcData = buf.getChannelData(ch);
        const dstData = newBuf.getChannelData(ch);
        // Copy pre-selection unchanged
        dstData.set(srcData.subarray(0, sStart), 0);
        // Resample selection
        for (let i = 0; i < dstLen; i++) {
          const srcIdx = Math.min(Math.round(i * ratio), srcLen - 1);
          dstData[sStart + i] = srcData[sStart + srcIdx]!;
        }
        // Copy post-selection unchanged
        const postSrc = srcData.subarray(sEnd);
        dstData.set(postSrc, sStart + dstLen);
      }

      // Replace AudioBuffer
      bufs[ti] = newBuf;

      // Rebuild Float32Array channels in clipboardRef
      const cbChannels = clip.tracks.get(ti);
      if (cbChannels) {
        const newChannels: Float32Array[] = Array.from({ length: numCh }, (_, ch) => {
          const arr = new Float32Array(newTotalLen);
          arr.set(newBuf.getChannelData(ch));
          return arr;
        });
        clip.tracks.set(ti, newChannels);
      }
    }

    // Recalculate duration from longest buffer
    const sampleRate = bufs.find(Boolean)?.sampleRate ?? 44100;
    const longestLen = bufs.reduce((mx, b) => Math.max(mx, b.length), 0);
    s.clipboardDurationSec = longestLen / sampleRate;
    clip.durationSec = s.clipboardDurationSec;

    // Recompute column count then amplitudes
    s.clipboardColumnCount = computeClipboardColumnCount(s.clipboardDurationSec);
    for (const ti of targetTracks) {
      recomputeClipboardTrackAmplitudes(ti);
    }

    const ratio2 = CB_SPEED_RATIOS[speedIdx]!;
    const label = speedIdx === CB_SPEED_NEUTRAL_IDX ? 'x1.0' : `x${ratio2.toFixed(2)}`;
    showTransientToast(`Speed: ${label}`, { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [recomputeClipboardTrackAmplitudes, bumpUi, showTransientToast]);

  const applyClipboardScrollStep = useCallback((sign: -1 | 1) => {
    const s = stateRef.current;
    const dur = s.clipboardDurationSec;
    if (dur <= 0) return;
    const delta = stepDivisionToSec(s.stepDivision);
    const now = getClipboardSongSecNow();
    const nearestGrid = Math.round(now / delta) * delta;
    const isAligned = Math.abs(now - nearestGrid) < 1e-3;
    let next: number;
    if (isAligned) {
      next = now + sign * delta;
    } else if (sign < 0) {
      next = Math.floor(now / delta) * delta;
    } else {
      next = Math.ceil(now / delta) * delta;
    }
    // Clamp to clipboard duration (no wrap-around for region navigation)
    next = Math.max(0, Math.min(dur - 1e-6, next));
    s.clipboardSongSec = next;
    if (s.clipboardPlaying) {
      stopAllClipboardSources();
      clipboardAnchorSongSecRef.current = next;
      const ctx = audioCtxRef.current;
      if (ctx) clipboardAnchorAudioTimeRef.current = ctx.currentTime;
      startClipboardPlayback();
    }
    bumpUi();
  }, [getClipboardSongSecNow, stopAllClipboardSources, startClipboardPlayback, bumpUi]);

  /** One grid step in song time: sign +1 = forward (ArrowRight), -1 = back (ArrowLeft). */
  const applySongScrollStep = useCallback((sign: -1 | 1) => {
    const s = stateRef.current;
    const delta = stepDivisionToSec(s.stepDivision);
    const now = getSongSecNow();
    const nearestGrid = Math.round(now / delta) * delta;
    const isAligned = Math.abs(now - nearestGrid) < 1e-3;
    let next: number;
    if (isAligned) {
      next = now + sign * delta;
    } else if (sign < 0) {
      next = Math.floor(now / delta) * delta;
    } else {
      next = Math.ceil(now / delta) * delta;
    }
    while (next < 0) next += SONG_DURATION_SEC;
    while (next >= SONG_DURATION_SEC) next -= SONG_DURATION_SEC;
    s.songSec = next;
    if (s.playing) {
      stopAllSources();
      anchorSongSecRef.current = next;
      const ctx = audioCtxRef.current;
      if (ctx) anchorAudioTimeRef.current = ctx.currentTime;
      startPlayback();
    }
    bumpUi();
  }, [getSongSecNow, stopAllSources, startPlayback, bumpUi]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      const sign = e.deltaY < 0 ? -1 : 1;
      if (stateRef.current.clipboardMode) {
        applyClipboardScrollStep(sign);
      } else {
        applySongScrollStep(sign);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applySongScrollStep, applyClipboardScrollStep]);

  const toggleMuteImmediate = useCallback(
    (trackIndex: number) => {
      const next = !stateRef.current.muted[trackIndex];
      stateRef.current.muted[trackIndex] = next;
      applyGainImmediate(trackIndex, next);
      bumpUi();
    },
    [applyGainImmediate, bumpUi]
  );

  const togglePendingOrCancel = useCallback(
    (trackIndex: number) => {
      const s = stateRef.current;
      const pending = s.pending;
      if (pending.has(trackIndex)) {
        pending.delete(trackIndex);
        bumpUi();
        return;
      }
      const markers = getAllMarkersSorted(s.userMarkerSongSec);
      const applied = computeSafeSyncApply(getSongSecNow(), s.syncMuteMode, markers);
      if (applied === null) {
        triggerRejectBlink([trackIndex]);
        return;
      }
      const { deltaPlayback, boundarySongSec } = applied;
      const ctx = audioCtxRef.current;
      const applyAtAudioTime = ctx && s.playing ? ctx.currentTime + deltaPlayback : null;
      pending.set(trackIndex, {
        targetMuted: !s.muted[trackIndex],
        boundarySongSec,
        applyAtAudioTime,
      });
      bumpUi();
    },
    [getSongSecNow, bumpUi, triggerRejectBlink]
  );

  // ---------------------------------------------------------------------------
  // Audio edit helpers
  // ---------------------------------------------------------------------------

  const recomputeTrackAmplitudes = useCallback((trackIndex: number) => {
    const buffers = buffersRef.current;
    const s = stateRef.current;
    if (!buffers || !s.amplitudes) return;
    const buf = buffers[trackIndex];
    if (!buf) return;
    s.amplitudes[trackIndex] = computeAmplitudes(buf, COLUMN_COUNT);
  }, []);

  // Enforce undo budget: evict oldest entries until total budget fits.
  const enforceUndoBudget = useCallback(() => {
    const stack = undoStackRef.current;
    const totalTrackSeconds = (entry: UndoEntry) => entry.durationSec * entry.restorations.length;
    let total = stack.reduce((acc, e) => acc + totalTrackSeconds(e), 0);
    while (total > UNDO_BUDGET_SEC && stack.length > 0) {
      total -= totalTrackSeconds(stack[0]!);
      stack.shift();
    }
  }, []);

  const handleCutCopy = useCallback((mode: 'cut' | 'copy', allUnmuted: boolean) => {
    const buffers = buffersRef.current;
    const s = stateRef.current;
    if (!buffers) return;

    const songSec = getSongSecNow();
    const section = getCurrentSection(songSec, s.userMarkerSongSec, SONG_DURATION_SEC);
    const durationSec = section.endSec - section.startSec;

    // Determine target tracks: either selected track only, or all currently unmuted tracks
    const targetTracks: number[] = allUnmuted
      ? Array.from({ length: TRACK_COUNT }, (_, i) => i).filter(i => !s.muted[i])
      : [s.selectedTrack];


    if (targetTracks.length === 0) return;

    // Memory limit check: combined duration across all target tracks <= 8 minutes
    const combinedSec = durationSec * targetTracks.length;
    if (combinedSec > UNDO_BUDGET_SEC) {
      showTransientToast(ERROR_COPY_MAX_LENGTH_MSG);
      return;
    }

    let sampleRate = 44100;
    for (const ti of targetTracks) {
      const buf = buffers[ti];
      if (buf) { sampleRate = buf.sampleRate; break; }
    }

    if (mode === 'cut') {
      // For CUT: extract audio into clipboard AND save original audio for undo in one pass,
      // then silence. This avoids a double-read after silencing.
      const clipTracks = new Map<number, Float32Array[]>();
      const restorations: UndoRestoration[] = [];

      for (const ti of targetTracks) {
        const buf = buffers[ti];
        if (!buf) continue;
        const extracted = extractAudioSection(buf, section.startSec, section.endSec);
        // Clipboard gets a copy; undo restoration gets its own independent copy
        clipTracks.set(ti, extracted.map(ch => ch.slice()));
        restorations.push({
          trackIndex: ti,
          startSample: Math.floor(section.startSec * buf.sampleRate),
          channels: extracted,
        });
        silenceAudioSection(buf, section.startSec, section.endSec);
        recomputeTrackAmplitudes(ti);
      }

      clipboardRef.current = { tracks: clipTracks, sampleRate, durationSec };
      undoStackRef.current.push({ type: 'cut', restorations, durationSec, sampleRate });
      enforceUndoBudget();
      redoEntryRef.current = null;
    } else {
      // For COPY: only build clipboard, no audio modification, no undo entry
      const clipTracks = new Map<number, Float32Array[]>();
      for (const ti of targetTracks) {
        const buf = buffers[ti];
        if (!buf) continue;
        clipTracks.set(ti, extractAudioSection(buf, section.startSec, section.endSec));
      }
      clipboardRef.current = { tracks: clipTracks, sampleRate, durationSec };
    }

    showTransientToast(
      mode === 'cut'
        ? (allUnmuted ? 'Cut: all unmuted' : 'Cut')
        : (allUnmuted ? 'Copy: all unmuted' : 'Copy'),
      { durationMs: COMMAND_TOAST_MS, variant: 'success' }
    );
    bumpUi();
  }, [getSongSecNow, recomputeTrackAmplitudes, enforceUndoBudget, bumpUi, showTransientToast]);

  const handlePaste = useCallback(() => {
    const buffers = buffersRef.current;
    const clip = clipboardRef.current;
    const s = stateRef.current;
    if (!buffers || !clip || clip.tracks.size === 0) return;

    const pasteStartSec = getSongSecNow();

    // Determine target tracks:
    // - Single track in clipboard -> paste into currently selected track (allows cross-track paste)
    // - Multiple tracks in clipboard -> paste back into their source tracks
    let targetMap: Map<number, Float32Array[]>;
    if (clip.tracks.size === 1) {
      const [, srcChannels] = [...clip.tracks.entries()][0]!;
      targetMap = new Map([[s.selectedTrack, srcChannels]]);
    } else {
      targetMap = clip.tracks;
    }

    // Budget check before any modification
    const combinedSec = clip.durationSec * targetMap.size;
    if (combinedSec > UNDO_BUDGET_SEC) {
      showTransientToast(ERROR_COPY_MAX_LENGTH_MSG);
      return;
    }

    const endSec = pasteStartSec + clip.durationSec;

    // Save pre-paste audio for undo, then overwrite
    const restorations: UndoRestoration[] = [];
    for (const [ti, srcChannels] of targetMap) {
      const buf = buffers[ti];
      if (!buf) continue;
      restorations.push({
        trackIndex: ti,
        startSample: Math.floor(pasteStartSec * buf.sampleRate),
        channels: extractAudioSection(buf, pasteStartSec, endSec),
      });
      overwriteAudioSection(buf, pasteStartSec, srcChannels);
      recomputeTrackAmplitudes(ti);
    }

    undoStackRef.current.push({
      type: 'paste',
      restorations,
      durationSec: clip.durationSec,
      sampleRate: clip.sampleRate,
    });
    enforceUndoBudget();
    redoEntryRef.current = null;

    showTransientToast('Paste', { durationMs: COMMAND_TOAST_MS, variant: 'success' });
    bumpUi();
  }, [getSongSecNow, recomputeTrackAmplitudes, enforceUndoBudget, bumpUi, showTransientToast]);

  const handleUndo = useCallback(() => {
    const buffers = buffersRef.current;
    const stack = undoStackRef.current;
    if (!buffers || stack.length === 0) return;

    const entry = stack.pop()!;

    // Capture current state at those positions for redo
    const redoRestorations: UndoRestoration[] = [];
    for (const rest of entry.restorations) {
      const buf = buffers[rest.trackIndex];
      if (!buf) continue;
      const startSec = rest.startSample / buf.sampleRate;
      const endSec = startSec + entry.durationSec;
      redoRestorations.push({
        trackIndex: rest.trackIndex,
        startSample: rest.startSample,
        channels: extractAudioSection(buf, startSec, endSec),
      });
      // Restore original audio
      overwriteAudioSection(buf, startSec, rest.channels);
      recomputeTrackAmplitudes(rest.trackIndex);
    }

    redoEntryRef.current = {
      type: entry.type,
      restorations: redoRestorations,
      durationSec: entry.durationSec,
      sampleRate: entry.sampleRate,
    };

    bumpUi();
  }, [recomputeTrackAmplitudes, bumpUi]);

  const handleRedo = useCallback(() => {
    const buffers = buffersRef.current;
    const redoEntry = redoEntryRef.current;
    if (!buffers || !redoEntry) return;

    // Capture current state for a new undo entry
    const undoRestorations: UndoRestoration[] = [];
    for (const rest of redoEntry.restorations) {
      const buf = buffers[rest.trackIndex];
      if (!buf) continue;
      const startSec = rest.startSample / buf.sampleRate;
      const endSec = startSec + redoEntry.durationSec;
      undoRestorations.push({
        trackIndex: rest.trackIndex,
        startSample: rest.startSample,
        channels: extractAudioSection(buf, startSec, endSec),
      });
      overwriteAudioSection(buf, startSec, rest.channels);
      recomputeTrackAmplitudes(rest.trackIndex);
    }

    undoStackRef.current.push({
      type: redoEntry.type,
      restorations: undoRestorations,
      durationSec: redoEntry.durationSec,
      sampleRate: redoEntry.sampleRate,
    });
    enforceUndoBudget();
    redoEntryRef.current = null;

    bumpUi();
  }, [recomputeTrackAmplitudes, enforceUndoBudget, bumpUi]);

  const enterClipboardMode = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || clip.tracks.size === 0) return;

    // Pause song playback if running
    if (stateRef.current.playing) {
      pausePlayback();
    }

    // Build AudioBuffers from clipboard Float32Arrays.
    // Use the existing AudioContext or a temporary offline one for buffer construction.
    const existingCtx = audioCtxRef.current;
    const bufCtx = existingCtx ?? new AudioContext();
    const bufs = buildClipboardBuffers(clip, bufCtx);
    if (!existingCtx) {
      // Store the context so playback can use it later
      audioCtxRef.current = bufCtx;
    }
    void bufCtx.resume();
    clipboardBuffersRef.current = bufs;

    // Compute amplitudes for each clipboard track
    const colCount = computeClipboardColumnCount(clip.durationSec);
    const amps: number[][] = bufs.map((buf) => computeAmplitudes(buf, colCount));

    const s = stateRef.current;
    s.clipboardMode = true;
    s.clipboardSongSec = 0;
    s.clipboardPlaying = false;
    s.clipboardSelectedTracks = Array(TRACK_COUNT).fill(false);
    s.clipboardSelection = null;
    s.clipboardAmplitudes = amps;
    s.clipboardColumnCount = colCount;
    s.clipboardDurationSec = clip.durationSec;
    s.cbModVolDb = 0;
    s.cbModPan = 0;
    s.cbModSpeedIdx = CB_SPEED_NEUTRAL_IDX;
    cbInternalClipRef.current = null;
    bumpUi();
  }, [pausePlayback, bumpUi]);

  const exitClipboardMode = useCallback(() => {
    // Stop clipboard playback
    if (stateRef.current.clipboardPlaying) {
      pauseClipboardPlayback();
    }
    stopAllClipboardSources();

    // Teardown clipboard gain nodes
    if (clipboardGainNodesRef.current) {
      for (const g of clipboardGainNodesRef.current) {
        try { g.disconnect(); } catch { /* ignore */ }
      }
      clipboardGainNodesRef.current = null;
    }
    clipboardBuffersRef.current = null;

    cbInternalClipRef.current = null;
    const s = stateRef.current;
    s.clipboardMode = false;
    s.clipboardPlaying = false;
    s.clipboardAmplitudes = null;
    bumpUi();
  }, [pauseClipboardPlayback, stopAllClipboardSources, bumpUi]);

  // Timeline pointer: only active in GRID zone (y: CMD_BAR_H … TRACKS_Y0)
  // Also handles bottom-bar clicks for clipboard mode toggle
  const onTimelinePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const ly = ((e.clientY - r.top) / r.height) * VISIBLE_HEIGHT;

      // Bottom-bar click: toggle clipboard mode
      if (ly >= BOTTOM_BAR_Y) {
        const lx = viewportClientXToLogical(canvas, e.clientX);
        const squareSize = 16;
        const squareGap = 3;
        const squaresStartX = Math.round(VISIBLE_WIDTH * 0.12);
        const squaresEndX = squaresStartX + TRACK_COUNT * (squareSize + squareGap);
        if (lx >= squaresStartX && lx <= squaresEndX) {
          if (stateRef.current.clipboardMode) {
            exitClipboardMode();
          } else if (clipboardRef.current && clipboardRef.current.tracks.size > 0) {
            enterClipboardMode();
          }
        }
        return;
      }

      // In clipboard mode: handle CMD-bar modifier action clicks, disable rest
      if (stateRef.current.clipboardMode) {
        if (ly < CMD_BAR_H) {
          const lx = viewportClientXToLogical(canvas, e.clientX);
          const slot = Math.floor(lx / (VISIBLE_WIDTH / CMD_ENCODER_SLOT_COUNT)); // 0-based slot index
          const s = stateRef.current;
          if (slot === 1) {
            // VOL drag-to-set
            cbModDragRef.current = { pointerId: e.pointerId, slot: 1, startClientX: e.clientX, startValue: s.cbModVolDb };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
          } else if (slot === 2) {
            // PAN drag-to-set
            cbModDragRef.current = { pointerId: e.pointerId, slot: 2, startClientX: e.clientX, startValue: s.cbModPan };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
          } else if (slot === 3) {
            // FADE: execute immediately
            handleClipboardFade(s.shiftDown ? 'in' : 'out');
            e.preventDefault();
          } else if (slot === 4) {
            // REVERSE: execute immediately
            handleClipboardReverse();
            e.preventDefault();
          } else if (slot === 5) {
            // SPEED drag-to-set
            cbModDragRef.current = { pointerId: e.pointerId, slot: 5, startClientX: e.clientX, startValue: s.cbModSpeedIdx };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
          }
        }
        return;
      }

      if (ly < CMD_BAR_H || ly >= TRACKS_Y0) return;
      const lx = viewportClientXToLogical(canvas, e.clientX);
      const songSec = getSongSecNow();
      const scrollX = scrollXFromSongSec(songSec);
      const hit = hitTestTimelineMarker(lx, scrollX, stateRef.current.userMarkerSongSec);
      if (hit.hit === 'zero') return;
      if (hit.hit === 'user' && hit.songSec !== undefined) {
        timelinePointerRef.current = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          kind: 'userMarker',
          sourceSec: hit.songSec,
          dragActive: false,
        };
        markerDragSourceSecRef.current = hit.songSec;
        markerDragGhostSecRef.current = hit.songSec;
      } else {
        timelinePointerRef.current = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          kind: 'empty',
          dragActive: false,
        };
        markerDragSourceSecRef.current = null;
        markerDragGhostSecRef.current = null;
      }
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [getSongSecNow, enterClipboardMode, exitClipboardMode, handleClipboardFade, handleClipboardReverse, handleClipboardSpeed]
  );

  const onTimelinePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Clipboard modifier drag (VOL / PAN)
      const drag = cbModDragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        const deltaX = e.clientX - drag.startClientX;
        const s = stateRef.current;
        if (drag.slot === 1) {
          s.cbModVolDb = Math.max(-60, Math.min(0, Math.round(drag.startValue + deltaX / 3)));
        } else if (drag.slot === 2) {
          const raw = Math.round((drag.startValue + deltaX / 2) / 10) * 10;
          s.cbModPan = Math.max(-100, Math.min(100, raw));
        } else if (drag.slot === 5) {
          const newIdx = Math.max(0, Math.min(CB_SPEED_RATIOS.length - 1, Math.round(drag.startValue + deltaX / 20)));
          s.cbModSpeedIdx = newIdx;
        }
        bumpUi();
        return;
      }

      const st = timelinePointerRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      if (st.kind !== 'userMarker' || st.sourceSec === undefined) return;
      const dist = Math.hypot(e.clientX - st.startClientX, e.clientY - st.startClientY);
      if (dist < TIMELINE_DRAG_THRESHOLD_PX) return;
      st.dragActive = true;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const lx = viewportClientXToLogical(canvas, e.clientX);
      const scrollX = scrollXFromSongSec(getSongSecNow());
      const raw = logicalXToSongSec(scrollX, lx);
      markerDragGhostSecRef.current = snapToStepDivision(raw, stateRef.current.stepDivision);
    },
    [getSongSecNow, bumpUi]
  );

  const onTimelinePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Clipboard modifier drag end (VOL / PAN): click (small dist) = execute
      const drag = cbModDragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        cbModDragRef.current = null;
        const canvas = canvasRef.current;
        if (canvas) { try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
        const dist = Math.abs(e.clientX - drag.startClientX);
        if (dist < 5) {
          // Click without drag → execute action with current value (skip neutral 0 dB / 0 LR)
          const clipS = stateRef.current;
          if (drag.slot === 1 && clipS.cbModVolDb !== 0) handleClipboardVol(clipS.cbModVolDb);
          else if (drag.slot === 2 && clipS.cbModPan !== 0) handleClipboardPan(clipS.cbModPan);
          else if (drag.slot === 5 && clipS.cbModSpeedIdx !== CB_SPEED_NEUTRAL_IDX) handleClipboardSpeed(clipS.cbModSpeedIdx);
        }
        return;
      }

      const st = timelinePointerRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      const canvas = canvasRef.current;
      if (canvas) {
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      }
      timelinePointerRef.current = null;
      const dist = Math.hypot(e.clientX - st.startClientX, e.clientY - st.startClientY);
      const songSec = getSongSecNow();
      const scrollX = scrollXFromSongSec(songSec);
      const lx = canvas ? viewportClientXToLogical(canvas, e.clientX) : 0;

      if (st.kind === 'userMarker' && st.sourceSec !== undefined) {
        const src = st.sourceSec;
        if (st.dragActive && markerDragGhostSecRef.current !== null) {
          const ghost = markerDragGhostSecRef.current;
          markerDragGhostSecRef.current = null;
          markerDragSourceSecRef.current = null;
          let u = stateRef.current.userMarkerSongSec.filter((t) => Math.abs(t - src) > 1e-4);
          if (ghost > 1e-4 && ghost < SONG_DURATION_SEC - 1e-4) {
            if (!u.some((t) => Math.abs(t - ghost) < 1e-4)) {
              u.push(ghost);
              u.sort((a, b) => a - b);
            }
          }
          stateRef.current.userMarkerSongSec = u;
        } else {
          markerDragGhostSecRef.current = null;
          markerDragSourceSecRef.current = null;
          stateRef.current.userMarkerSongSec = stateRef.current.userMarkerSongSec.filter(
            (t) => Math.abs(t - src) > 1e-4
          );
        }
        bumpUi();
        return;
      }

      markerDragGhostSecRef.current = null;
      markerDragSourceSecRef.current = null;
      if (dist > TIMELINE_DRAG_THRESHOLD_PX || !canvas) return;
      const hit = hitTestTimelineMarker(lx, scrollX, stateRef.current.userMarkerSongSec);
      if (hit.hit === 'user' && hit.songSec !== undefined) {
        stateRef.current.userMarkerSongSec = stateRef.current.userMarkerSongSec.filter(
          (t) => Math.abs(t - hit.songSec!) > 1e-4
        );
        bumpUi();
        return;
      }
      if (hit.hit === 'zero') return;
      const raw = logicalXToSongSec(scrollX, lx);
      const snapped = snapToStepDivision(raw, stateRef.current.stepDivision);
      if (snapped <= 1e-4) return;
      const u = stateRef.current.userMarkerSongSec;
      if (u.some((t) => Math.abs(t - snapped) < 1e-4)) return;
      stateRef.current.userMarkerSongSec = [...u, snapped].sort((a, b) => a - b);
      bumpUi();
    },
    [getSongSecNow, bumpUi, handleClipboardVol, handleClipboardPan, handleClipboardSpeed]
  );

  // Audio loading
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buffers: AudioBuffer[] = [];
        const tmpCtx = new AudioContext();
        for (const url of TRACK_URLS) {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
          const ab = await res.arrayBuffer();
          const buf = await tmpCtx.decodeAudioData(ab.slice(0));
          buffers.push(buf);
        }
        await tmpCtx.close();
        if (cancelled) return;
        const amps = buffers.map((b) => computeAmplitudes(b, COLUMN_COUNT));
        buffersRef.current = buffers;
        stateRef.current.amplitudes = amps;
        setAudioReady(true);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        stateRef.current.loadError = msg;
        bumpUi();
      }
    })();
    return () => { cancelled = true; };
  }, [bumpUi]);

  // Preload Monogram font so canvas can use it immediately
  useEffect(() => {
    void document.fonts.load('20px Monogram');
  }, []);

  const ensureAudioGraph = useCallback(() => {
    if (audioCtxRef.current && gainNodesRef.current) return audioCtxRef.current;
    const ctx = new AudioContext();
    const gains: GainNode[] = [];
    for (let i = 0; i < TRACK_COUNT; i++) {
      const g = ctx.createGain();
      g.gain.value = stateRef.current.muted[i] ? 0 : 1;
      g.connect(ctx.destination);
      gains.push(g);
    }
    audioCtxRef.current = ctx;
    gainNodesRef.current = gains;
    return ctx;
  }, []);

  const handlePlayClick = useCallback(async () => {
    if (!audioReady || !buffersRef.current) return;
    const ctx = ensureAudioGraph();
    await ctx.resume();
    if (stateRef.current.clipboardMode) {
      if (stateRef.current.clipboardPlaying) {
        pauseClipboardPlayback();
      } else {
        startClipboardPlayback();
      }
      return;
    }
    if (stateRef.current.playing) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }, [audioReady, ensureAudioGraph, pausePlayback, startPlayback, pauseClipboardPlayback, startClipboardPlayback]);

  // Keyboard input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Allow key-repeat for arrow scrolling; block repeat for all other keys
      if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const s = stateRef.current;

      // F1–F9: step-division presets — must preventDefault + capture so the browser
      // does not handle F5 (reload), F3 (search), F7 (caret browsing), etc.
      if (e.code.startsWith('F')) {
        const n = parseInt(e.code.slice(1), 10);
        if (Number.isFinite(n) && n >= 1 && n <= 9) {
          e.preventDefault();
          e.stopPropagation();
          const idx = n - 1;
          if (idx < STEP_DIVISIONS.length) {
            s.stepDivision = STEP_DIVISIONS[idx]!;
            bumpUi();
          }
          return;
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        void handlePlayClick();
        return;
      }

      if (isShiftCode(e.code)) {
        clearTimeout(shiftResetTimerRef.current);
        s.shiftDown = true;
        bumpUi();
        return;
      }

      // For Numpad5–9/Subtract: cancel any pending phantom-shift-reset so
      // s.shiftDown stays true if the user is holding Shift.
      if (e.code === 'Numpad5' || e.code === 'Numpad6' ||
          e.code === 'Numpad7' || e.code === 'Numpad8' ||
          e.code === 'Numpad9' || e.code === 'NumpadSubtract') {
        clearTimeout(shiftResetTimerRef.current);
      }

      // ── Clipboard Overview Mode keyboard branch ──────────────────────────
      if (s.clipboardMode) {
        // Escape: exit clipboard mode
        if (e.code === 'Escape') {
          e.preventDefault();
          exitClipboardMode();
          return;
        }

        // Numpad5: set clipboard selection start
        if (e.code === 'Numpad5') {
          e.preventDefault();
          const t = Math.min(Math.max(0, getClipboardSongSecNow()), s.clipboardDurationSec);
          const prevEnd = s.clipboardSelection?.endSec ?? -1;
          s.clipboardSelection = prevEnd > t + 1e-4
            ? { startSec: t, endSec: prevEnd }
            : { startSec: t, endSec: -1 };
          bumpUi();
          return;
        }

        // Numpad6: set clipboard selection end; end <= start clears selection
        if (e.code === 'Numpad6') {
          e.preventDefault();
          const t = Math.min(Math.max(0, getClipboardSongSecNow()), s.clipboardDurationSec);
          const startSec = s.clipboardSelection?.startSec ?? 0;
          if (t <= startSec + 1e-4) {
            s.clipboardSelection = null;
          } else {
            s.clipboardSelection = { startSec, endSec: t };
          }
          bumpUi();
          return;
        }

        // Arrow keys + SHIFT+ArrowLeft: scroll clipboard
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (e.shiftKey && e.key === 'ArrowLeft') {
            s.clipboardSongSec = 0;
            if (s.clipboardPlaying) {
              stopAllClipboardSources();
              clipboardAnchorSongSecRef.current = 0;
              const ctx = audioCtxRef.current;
              if (ctx) clipboardAnchorAudioTimeRef.current = ctx.currentTime;
              startClipboardPlayback();
            }
            bumpUi();
            return;
          }
          applyClipboardScrollStep(e.key === 'ArrowLeft' ? -1 : 1);
          return;
        }

        // Numpad8: CUT within clipboard (into internal clipboard)
        if (e.code === 'Numpad8') {
          e.preventDefault();
          handleClipboardCutCopy('cut');
          return;
        }

        // Numpad9: COPY within clipboard (into internal clipboard)
        if (e.code === 'Numpad9') {
          e.preventDefault();
          handleClipboardCutCopy('copy');
          return;
        }

        // NumpadSubtract: PASTE from internal clipboard into clipboard tracks
        if (e.code === 'NumpadSubtract') {
          e.preventDefault();
          handleClipboardPaste();
          return;
        }

        // 1-8 / SHIFT+1-8: track selection
        const cbDigit =
          e.code >= 'Digit1' && e.code <= 'Digit8' ? parseInt(e.code.slice(5), 10) - 1 : -1;
        const cbNumpad =
          e.code >= 'Numpad1' && e.code <= 'Numpad4'
            ? parseInt(e.code.slice(6), 10) - 1
            : -1;
        const cbTrack = cbDigit >= 0 ? cbDigit : cbNumpad;
        if (cbTrack >= 0 && cbTrack < TRACK_COUNT) {
          e.preventDefault();
          if (e.shiftKey) {
            // SHIFT+1-8: multi-toggle — add/remove track from selection
            s.clipboardSelectedTracks = s.clipboardSelectedTracks.map((v, i) =>
              i === cbTrack ? !v : v
            );
          } else {
            // 1-8 without Shift: exclusive single-track selection
            s.clipboardSelectedTracks = s.clipboardSelectedTracks.map((_, i) =>
              i === cbTrack
            );
          }
          bumpUi();
          return;
        }

        // Block all other unhandled actions in clipboard mode
        return;
      }

      // ── Normal mode keyboard handlers ─────────────────────────────────────

      // Numpad5: set loop-selection start (keeps existing end if valid)
      if (e.code === 'Numpad5') {
        e.preventDefault();
        const t = Math.min(Math.max(0, getSongSecNow()), SONG_DURATION_SEC);
        const prevEnd = s.loopSelection?.endSec ?? -1;
        // Keep the stored end-point; selection becomes active only when end > start
        s.loopSelection = prevEnd > t + 1e-4
          ? { startSec: t, endSec: prevEnd }
          : { startSec: t, endSec: -1 }; // end not yet set or invalid after move
        bumpUi();
        return;
      }

      // Numpad6: set loop-selection end; end <= start (or at time 0) clears the loop
      if (e.code === 'Numpad6') {
        e.preventDefault();
        const t = Math.min(Math.max(0, getSongSecNow()), SONG_DURATION_SEC);
        const startSec = s.loopSelection?.startSec ?? 0;
        if (t <= startSec + 1e-4) {
          // end at or before start → deactivate (including: jump to 0, press Numpad6)
          s.loopSelection = null;
        } else {
          s.loopSelection = { startSec, endSec: t };
        }
        bumpUi();
        return;
      }

      // Numpad7: toggle marker at playhead (snapped); Shift+Numpad7 clears all user markers
      if (e.code === 'Numpad7') {
        e.preventDefault();
        if (s.shiftDown) {
          s.userMarkerSongSec = [];
        } else {
          const snapped = snapToStepDivision(getSongSecNow(), s.stepDivision);
          // No toggle at implicit song-start marker (same as mouse on zero hit)
          if (snapped > 1e-4) {
            if (s.userMarkerSongSec.some((t) => Math.abs(t - snapped) < 1e-4)) {
              s.userMarkerSongSec = s.userMarkerSongSec.filter((t) => Math.abs(t - snapped) > 1e-4);
            } else {
              s.userMarkerSongSec = [...s.userMarkerSongSec, snapped].sort((a, b) => a - b);
            }
          }
        }
        bumpUi();
        return;
      }

      // Numpad8: CUT (Shift = all unmuted tracks)
      if (e.code === 'Numpad8') {
        e.preventDefault();
        handleCutCopy('cut', s.shiftDown);
        return;
      }

      // Numpad9: COPY (Shift = all unmuted tracks)
      if (e.code === 'Numpad9') {
        e.preventDefault();
        handleCutCopy('copy', s.shiftDown);
        return;
      }

      // NumpadSubtract: PASTE
      if (e.code === 'NumpadSubtract') {
        e.preventDefault();
        handlePaste();
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey && e.key === 'ArrowLeft') {
          s.songSec = 0;
          if (s.playing) {
            stopAllSources();
            anchorSongSecRef.current = 0;
            const ctx = audioCtxRef.current;
            if (ctx) { anchorAudioTimeRef.current = ctx.currentTime; startPlayback(); }
          }
          bumpUi();
          return;
        }
        applySongScrollStep(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }

      const digit =
        e.code >= 'Digit1' && e.code <= 'Digit8' ? parseInt(e.code.slice(5), 10) - 1 : -1;
      // Numpad5/6 are reserved for loop-selection; Numpad7/8/9 for marker/cut/copy
      const numpadCode = e.code;
      const numpad =
        numpadCode >= 'Numpad1' && numpadCode <= 'Numpad4'
          ? parseInt(numpadCode.slice(6), 10) - 1
          : -1;
      const trackIndex = digit >= 0 ? digit : numpad;

      if (trackIndex >= 0 && trackIndex < TRACK_COUNT) {
        if (e.shiftKey) {
          e.preventDefault();
          if (s.syncMuteMode === 'OFF' || !s.playing) {
            toggleMuteImmediate(trackIndex);
            return;
          }
          togglePendingOrCancel(trackIndex);
          return;
        }
        e.preventDefault();
        s.selectedTrack = trackIndex;
        bumpUi();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isShiftCode(e.code)) return;
      // Delay the shiftDown reset by 80ms. If a Numpad keydown arrives in
      // that window it will cancel this timer (see clearTimeout above),
      // preventing a phantom Windows NumLock shift-release from clearing
      // the flag before the Numpad handler reads it.
      clearTimeout(shiftResetTimerRef.current);
      shiftResetTimerRef.current = window.setTimeout(() => {
        stateRef.current.shiftDown = false;
        bumpUi();
      }, 80);
    };

    const onBlur = () => {
      clearTimeout(shiftResetTimerRef.current);
      stateRef.current.shiftDown = false;
      bumpUi();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearTimeout(shiftResetTimerRef.current);
    };
  }, [
    applySongScrollStep,
    applyClipboardScrollStep,
    bumpUi,
    exitClipboardMode,
    getClipboardSongSecNow,
    getSongSecNow,
    handleClipboardCutCopy,
    handleClipboardPaste,
    handleCutCopy,
    handlePaste,
    handlePlayClick,
    startClipboardPlayback,
    startPlayback,
    stopAllClipboardSources,
    stopAllSources,
    toggleMuteImmediate,
    togglePendingOrCancel,
  ]);

  // rAF draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const draw = () => {
      const s = stateRef.current;
      let songSec = s.songSec;
      const actx = audioCtxRef.current;

      if (s.playing && actx) {
        const elapsed = actx.currentTime - anchorAudioTimeRef.current;
        songSec = anchorSongSecRef.current + elapsed;
        while (songSec >= SONG_DURATION_SEC) songSec -= SONG_DURATION_SEC;
        while (songSec < 0) songSec += SONG_DURATION_SEC;

        // ── Loop-Selection wrap ──────────────────────────────────────────
        const loop = s.loopSelection;
        if (loop && loop.endSec > loop.startSec + 1e-4) {
          const prev = prevSongSecRef.current;
          // Detect forward crossing of loopEnd (handles wrap-around at song boundary)
          const crossed =
            prev >= 0 &&
            prev < loop.endSec &&
            songSec >= loop.endSec - 1e-4;
          if (crossed) {
            songSec = loop.startSec;
            s.songSec = songSec;
            stopAllSources();
            anchorSongSecRef.current = songSec;
            anchorAudioTimeRef.current = actx.currentTime;
            startPlayback();
          }
        }
        prevSongSecRef.current = songSec;

        if (s.pending.size > 0 && s.syncMuteMode !== 'OFF') {
          const now = actx.currentTime;
          let anyApplied = false;
          for (const [trackIndex, entry] of [...s.pending]) {
            if (entry.applyAtAudioTime !== null && now + 1e-4 >= entry.applyAtAudioTime) {
              s.muted[trackIndex] = entry.targetMuted;
              applyGainImmediate(trackIndex, entry.targetMuted);
              s.pending.delete(trackIndex);
              anyApplied = true;
            }
          }
          if (anyApplied) bumpUi();
        }
      }

      // ── Clipboard Overview Mode: update clipboard playhead ──────────────
      let clipboardSec = s.clipboardSongSec;
      if (s.clipboardMode && s.clipboardPlaying && actx) {
        const elapsed = actx.currentTime - clipboardAnchorAudioTimeRef.current;
        clipboardSec = clipboardAnchorSongSecRef.current + elapsed;
        const dur = s.clipboardDurationSec;
        if (dur > 0) {
          while (clipboardSec >= dur) clipboardSec -= dur;
          while (clipboardSec < 0) clipboardSec += dur;
        }
        s.clipboardSongSec = clipboardSec;
      }

      // ── Active display values (switch between song and clipboard mode) ───
      const isClipMode = s.clipboardMode;
      const displaySec = isClipMode ? clipboardSec : songSec;
      const displayDuration = isClipMode ? s.clipboardDurationSec : SONG_DURATION_SEC;
      const displayScrollX = displaySec * PIXELS_PER_SECOND - CURSOR_X;
      const displayAmps = isClipMode ? s.clipboardAmplitudes : s.amplitudes;
      const displayColCount = isClipMode ? s.clipboardColumnCount : COLUMN_COUNT;

      const scrollX = displayScrollX;
      const w = VISIBLE_WIDTH;
      const nowPerf = performance.now();
      const blinkPhase = Math.floor((nowPerf / 1000) * BLINK_HZ) % 2 === 0;
      const rejectUntil = rejectBlinkEndMsRef.current;
      const rejectActive = nowPerf < rejectUntil;
      const rejectPhase = Math.floor((nowPerf / 1000) * REJECT_BLINK_HZ) % 2 === 0;
      if (!rejectActive && rejectBlinkTracksRef.current.size > 0) {
        rejectBlinkTracksRef.current.clear();
      }

      // ── Background ──────────────────────────────────────────────────────
      ctx2d.fillStyle = COLOR_LANE_BG;
      ctx2d.fillRect(0, 0, w, VISIBLE_HEIGHT);

      // ── CMD bar ─────────────────────────────────────────────────────────
      ctx2d.fillStyle = COLOR_CMD_BAR_BG;
      ctx2d.fillRect(0, 0, w, CMD_BAR_H);

      // ── Grid area ───────────────────────────────────────────────────────
      ctx2d.fillStyle = COLOR_CMD_BAR_BG;
      ctx2d.fillRect(0, CMD_BAR_H, w, GRID_H);

      const beatDur = beatDurationSec();
      const firstBeat = Math.floor((scrollX / PIXELS_PER_SECOND) / beatDur);
      const lastBeat = Math.ceil(((scrollX + w) / PIXELS_PER_SECOND) / beatDur);

      for (let b = firstBeat; b <= lastBeat; b++) {
        const t = b * beatDur;
        const x = t * PIXELS_PER_SECOND - scrollX;
        if (x < -2 || x > w + 2) continue;
        const isBar = b % BEATS_PER_BAR === 0;
        ctx2d.strokeStyle = isBar ? COLOR_TICK_BAR : COLOR_TICK_BEAT;
        ctx2d.lineWidth = 2;
        ctx2d.beginPath();
        ctx2d.moveTo(x + 0.5, CMD_BAR_H + (isBar ? 2 : 8));
        ctx2d.lineTo(x + 0.5, CMD_BAR_H + GRID_H);
        ctx2d.stroke();
      }

      if (!isClipMode) {
        // ── Current section highlight in grid area (song mode only) ────────
        {
          const section = getCurrentSection(songSec, s.userMarkerSongSec, SONG_DURATION_SEC);
          const sx = section.startSec * PIXELS_PER_SECOND - scrollX;
          const ex = section.endSec * PIXELS_PER_SECOND - scrollX;
          ctx2d.fillStyle = COLOR_SEGMENT_SELECTION;
          ctx2d.fillRect(sx, CMD_BAR_H, ex - sx, GRID_H);
        }

        // ── Loop-selection highlight + flag triangles (song mode only) ─────
        {
          const loop = s.loopSelection;
          if (loop && loop.endSec > loop.startSec + 1e-4) {
            const sx = loop.startSec * PIXELS_PER_SECOND - scrollX;
            const ex = loop.endSec * PIXELS_PER_SECOND - scrollX;
            ctx2d.fillStyle = COLOR_LOOP_SELECTION;
            ctx2d.fillRect(sx, CMD_BAR_H, ex - sx, GRID_H);
            const triBase = 7;
            const triH = 8;
            const triY0 = CMD_BAR_H + 4;
            ctx2d.fillStyle = COLOR_LOOP_SELECTION_MARKER;
            ctx2d.beginPath();
            ctx2d.moveTo(sx, triY0);
            ctx2d.lineTo(sx + triBase, triY0 + triH / 2);
            ctx2d.lineTo(sx, triY0 + triH);
            ctx2d.closePath();
            ctx2d.fill();
            ctx2d.beginPath();
            ctx2d.moveTo(ex, triY0);
            ctx2d.lineTo(ex - triBase, triY0 + triH / 2);
            ctx2d.lineTo(ex, triY0 + triH);
            ctx2d.closePath();
            ctx2d.fill();
          }
        }
      } else {
        // ── Clipboard selection highlight + flag triangles ───────────────────
        {
          const sel = s.clipboardSelection;
          if (sel && sel.endSec > sel.startSec + 1e-4) {
            const sx = sel.startSec * PIXELS_PER_SECOND - scrollX;
            const ex = sel.endSec * PIXELS_PER_SECOND - scrollX;
            // Tinted overlay
            ctx2d.fillStyle = COLOR_CLIP_SELECTION;
            ctx2d.fillRect(sx, CMD_BAR_H, ex - sx, GRID_H);
            // Corner-filling right-angle triangles at start (top-left) and end (top-right), 12x12 px
            const c = 12;
            const ty = CMD_BAR_H;
            ctx2d.fillStyle = COLOR_CLIP_SELECTION_MARKER;
            // Start: fills top-left corner of selection
            ctx2d.beginPath();
            ctx2d.moveTo(sx, ty);
            ctx2d.lineTo(sx + c, ty);
            ctx2d.lineTo(sx, ty + c);
            ctx2d.closePath();
            ctx2d.fill();
            // End: fills top-right corner of selection
            ctx2d.beginPath();
            ctx2d.moveTo(ex, ty);
            ctx2d.lineTo(ex - c, ty);
            ctx2d.lineTo(ex, ty + c);
            ctx2d.closePath();
            ctx2d.fill();
          }
        }
      }

      // ── Clipboard duration end marker (in clipboard mode) ────────────────
      if (isClipMode && displayDuration > 0) {
        const endX = displayDuration * PIXELS_PER_SECOND - scrollX;
        if (endX >= -2 && endX <= w + 2) {
          ctx2d.strokeStyle = '#ffaa00';
          ctx2d.lineWidth = 1;
          ctx2d.beginPath();
          ctx2d.moveTo(endX + 0.5, CMD_BAR_H);
          ctx2d.lineTo(endX + 0.5, TRACKS_Y0 + TRACK_COUNT * TRACK_H);
          ctx2d.stroke();
        }
      }

      // ── Track lanes ─────────────────────────────────────────────────────
      const amps = displayAmps;
      for (let tr = 0; tr < TRACK_COUNT; tr++) {
        const y0 = TRACKS_Y0 + tr * TRACK_H;
        ctx2d.fillStyle = COLOR_LANE_BG;
        ctx2d.fillRect(0, y0, w, TRACK_H);

        const centerY = y0 + Math.floor(TRACK_H / 2);
        const maxHalf = Math.floor(TRACK_H / 2) - 4;

        let baseColor: string;
        if (isClipMode) {
          // 4-state color model: has-audio × selected
          const cbHasAudio = clipboardRef.current?.tracks.has(tr) ?? false;
          const cbSel = s.clipboardSelectedTracks[tr] ?? false;
          if (cbSel && cbHasAudio)       baseColor = COLOR_WAVE_SELECTED;
          else if (cbSel && !cbHasAudio) baseColor = COLOR_WAVE_MUTED_SEL;
          else if (cbHasAudio)           baseColor = COLOR_WAVE_NORMAL;
          else                           baseColor = COLOR_WAVE_MUTED;
        } else {
          const muted = s.muted[tr]!;
          const sel = s.selectedTrack === tr;
          const hasPending = s.pending.has(tr);
          baseColor = COLOR_WAVE_NORMAL;
          if (sel && !muted) baseColor = COLOR_WAVE_SELECTED;
          else if (sel && muted) baseColor = COLOR_WAVE_MUTED_SEL;
          else if (muted) baseColor = COLOR_WAVE_MUTED;

          const inRejectBlink = rejectActive && rejectBlinkTracksRef.current.has(tr);
          const waveformBlink = hasPending || inRejectBlink;
          const blinkUse = inRejectBlink ? rejectPhase : blinkPhase;

          if (amps?.[tr]) {
            const colStart = Math.max(0, Math.floor(scrollX / BAR_PITCH));
            const colEnd = Math.min(displayColCount - 1, Math.ceil((scrollX + w) / BAR_PITCH));
            const barW = 2;

            for (let col = colStart; col <= colEnd; col++) {
              const sx = col * BAR_PITCH - scrollX;
              if (sx + barW <= 0 || sx >= w) continue;
              const amp = amps[tr]![col] ?? 0.02;
              const hBar = Math.max(1, Math.min(maxHalf, Math.round(amp * maxHalf * 1.2)));

              let fill = baseColor;
              if (waveformBlink && blinkUse) {
                fill =
                  fill === COLOR_WAVE_SELECTED ? COLOR_WAVE_MUTED_SEL :
                  fill === COLOR_WAVE_NORMAL   ? COLOR_WAVE_MUTED :
                  fill === COLOR_WAVE_MUTED_SEL ? COLOR_WAVE_SELECTED :
                  COLOR_WAVE_NORMAL;
              }

              ctx2d.fillStyle = fill;
              ctx2d.fillRect(Math.floor(sx), centerY - 2 - hBar, barW, hBar);
              ctx2d.fillRect(Math.floor(sx), centerY + 2, barW, hBar);
            }
          }

          // Centerline drawn AFTER bars (song mode): always static baseColor.
          const clY = centerY - 2;
          ctx2d.fillStyle = baseColor;
          const clColStart = Math.floor(scrollX / BAR_PITCH) - 1;
          const clColEnd = Math.ceil((scrollX + w) / BAR_PITCH) + 1;
          for (let col = clColStart; col <= clColEnd; col++) {
            const clX = Math.floor(col * BAR_PITCH - scrollX);
            if (clX + 2 <= 0 || clX >= w) continue;
            ctx2d.fillRect(clX, clY, 2, 4);
          }

          // Upcoming sync-mute marker line (song mode only)
          const pe = s.pending.get(tr);
          if (s.syncMuteMode !== 'OFF' && pe) {
            let rem: number;
            if (s.playing && actx && pe.applyAtAudioTime !== null) {
              rem = pe.applyAtAudioTime - actx.currentTime;
            } else {
              rem = playbackSecondsToBoundary(songSec, pe.boundarySongSec);
            }
            const mx = CURSOR_X + rem * PIXELS_PER_SECOND;
            if (mx >= -2 && mx <= w + 2) {
              ctx2d.strokeStyle = COLOR_SYNC_UPCOMING_MARKER;
              ctx2d.lineWidth = 2;
              ctx2d.beginPath();
              ctx2d.moveTo(mx + 0.5, y0 + 1);
              ctx2d.lineTo(mx + 0.5, y0 + TRACK_H - 2);
              ctx2d.stroke();
            }
          }

          // Lane separator
          ctx2d.strokeStyle = '#112818';
          ctx2d.lineWidth = 1;
          ctx2d.beginPath();
          ctx2d.moveTo(0, y0 + TRACK_H - 0.5);
          ctx2d.lineTo(w, y0 + TRACK_H - 0.5);
          ctx2d.stroke();
          continue; // song mode track done
        }

        // Clipboard mode track rendering — only draw amplitude bars if the track has audio
        if ((clipboardRef.current?.tracks.has(tr) ?? false) && amps?.[tr]) {
          const colStart = Math.max(0, Math.floor(scrollX / BAR_PITCH));
          const colEnd = Math.min(displayColCount - 1, Math.ceil((scrollX + w) / BAR_PITCH));
          const barW = 2;
          for (let col = colStart; col <= colEnd; col++) {
            const sx = col * BAR_PITCH - scrollX;
            if (sx + barW <= 0 || sx >= w) continue;
            const amp = amps[tr]![col] ?? 0.02;
            const hBar = Math.max(1, Math.min(maxHalf, Math.round(amp * maxHalf * 1.2)));
            ctx2d.fillStyle = baseColor;
            ctx2d.fillRect(Math.floor(sx), centerY - 2 - hBar, barW, hBar);
            ctx2d.fillRect(Math.floor(sx), centerY + 2, barW, hBar);
          }
        }

        // Centerline (clipboard mode)
        const clY = centerY - 2;
        ctx2d.fillStyle = baseColor;
        const clColStart = Math.floor(scrollX / BAR_PITCH) - 1;
        const clColEnd = Math.ceil((scrollX + w) / BAR_PITCH) + 1;
        for (let col = clColStart; col <= clColEnd; col++) {
          const clX = Math.floor(col * BAR_PITCH - scrollX);
          if (clX + 2 <= 0 || clX >= w) continue;
          ctx2d.fillRect(clX, clY, 2, 4);
        }

        // Lane separator
        ctx2d.strokeStyle = '#112818';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, y0 + TRACK_H - 0.5);
        ctx2d.lineTo(w, y0 + TRACK_H - 0.5);
        ctx2d.stroke();
      }

      // ── Playhead cursor line ─────────────────────────────────────────────
      ctx2d.strokeStyle = COLOR_CURSOR;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(CURSOR_X + 0.5, CMD_BAR_H);
      ctx2d.lineTo(CURSOR_X + 0.5, TRACKS_Y0 + TRACK_COUNT * TRACK_H);
      ctx2d.stroke();

      if (!isClipMode) {
        // ── Timeline marker triangles (song mode only) ─────────────────────
        const drawTimelineTriangle = (screenX: number, alpha: number) => {
          const sx = Math.round(screenX);
          if (sx < -14 || sx > w + 14) return;
          ctx2d.save();
          ctx2d.globalAlpha = alpha;
          ctx2d.fillStyle = COLOR_TRIANGLE;
          ctx2d.beginPath();
          ctx2d.moveTo(sx - 12, CMD_BAR_H);
          ctx2d.lineTo(sx + 12, CMD_BAR_H);
          ctx2d.lineTo(sx, CMD_BAR_H + 12);
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.restore();
        };

        const tp = timelinePointerRef.current;
        const dragSrc = markerDragSourceSecRef.current;
        const dragGhost = markerDragGhostSecRef.current;
        const draggingUser =
          tp !== null && tp.kind === 'userMarker' && tp.dragActive && dragSrc !== null;

        const markerList = getAllMarkersSorted(s.userMarkerSongSec);
        for (const m of markerList) {
          if (draggingUser && Math.abs(m - dragSrc!) < 1e-4) continue;
          const mx = m * PIXELS_PER_SECOND - scrollX;
          drawTimelineTriangle(mx, 1);
        }
        if (draggingUser && dragGhost !== null) {
          const gx = dragGhost * PIXELS_PER_SECOND - scrollX;
          drawTimelineTriangle(gx, 0.5);
        }
      }

      // ── Bottom status bar ────────────────────────────────────────────────
      ctx2d.fillStyle = COLOR_CMD_BAR_BG;
      ctx2d.fillRect(0, BOTTOM_BAR_Y, w, BOTTOM_BAR_H);

      ctx2d.strokeStyle = '#1a3828';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, BOTTOM_BAR_Y + 0.5);
      ctx2d.lineTo(w, BOTTOM_BAR_Y + 0.5);
      ctx2d.stroke();

      ctx2d.textBaseline = 'middle';
      const barMidY = BOTTOM_BAR_Y + BOTTOM_BAR_H / 2;

      if (s.shiftDown && isClipMode) {
        // Clipboard mode + SHIFT: show track numbers with selection colors
        ctx2d.font = '20px Monogram, monospace';
        ctx2d.textAlign = 'center';
        for (let tr = 0; tr < TRACK_COUNT; tr++) {
          const cx = ((tr + 0.5) / TRACK_COUNT) * w;
          const cbSel = s.clipboardSelectedTracks[tr];
          ctx2d.fillStyle = cbSel ? COLOR_WAVE_SELECTED : COLOR_LABEL_UNMUTED;
          ctx2d.fillText(String(tr + 1), cx, barMidY);
        }
      } else if (s.shiftDown && !isClipMode) {
        // Song mode + SHIFT: show track numbers with mute-state colors
        ctx2d.font = '20px Monogram, monospace';
        ctx2d.textAlign = 'center';
        for (let tr = 0; tr < TRACK_COUNT; tr++) {
          const cx = ((tr + 0.5) / TRACK_COUNT) * w;
          const muted = s.muted[tr]!;
          const hasPending = s.pending.has(tr);
          let lab = muted ? COLOR_LABEL_MUTED : COLOR_LABEL_UNMUTED;

          const inRejectBlinkNum = rejectActive && rejectBlinkTracksRef.current.has(tr);
          const numberPendingBlink = hasPending && blinkPhase;

          if (inRejectBlinkNum) {
            lab = muted
              ? (rejectPhase ? '#ffb84a' : COLOR_LABEL_MUTED)
              : (rejectPhase ? '#fff4dd' : COLOR_LABEL_UNMUTED);
          } else if (numberPendingBlink) {
            lab = muted ? '#443010' : '#886020';
          }

          ctx2d.fillStyle = lab;
          ctx2d.fillText(String(tr + 1), cx, barMidY);
        }
      } else {
        // Show 8 squares (clipboard state) + T mm:ss + B bars:beats
        const squareSize = 16;
        const squareGap = 3;
        const squaresStartX = Math.round(w * 0.12);
        const squareY = BOTTOM_BAR_Y + Math.floor((BOTTOM_BAR_H - squareSize) / 2);
        const clip = clipboardRef.current;
        for (let i = 0; i < TRACK_COUNT; i++) {
          const hasCb = clip !== null && clip.tracks.has(i);
          ctx2d.fillStyle = hasCb ? COLOR_BOTTOM_SQUARE_FILLED : COLOR_BOTTOM_SQUARE;
          ctx2d.fillRect(squaresStartX + i * (squareSize + squareGap), squareY, squareSize, squareSize);
        }

        const dispSecInt = Math.floor(displaySec);
        const mm = Math.floor(dispSecInt / 60).toString().padStart(2, '0');
        const ss = (dispSecInt % 60).toString().padStart(2, '0');
        const tStr = `T ${mm}:${ss}`;

        const totalBeats = Math.floor(displaySec / beatDur);
        const bar = Math.floor(totalBeats / BEATS_PER_BAR);
        const beat = (totalBeats % BEATS_PER_BAR) + 1;
        const bStr = `B ${bar.toString().padStart(2, '0')}:${beat.toString().padStart(2, '0')}`;

        ctx2d.fillStyle = COLOR_CMD_TEXT;
        ctx2d.font = '20px Monogram, monospace';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(tStr, 480, barMidY);
        ctx2d.fillText(bStr, 680, barMidY);

        // Mode label bottom-left: orange "CLIPBOARD" vs "AUDIO"
        ctx2d.font = '20px Monogram, monospace';
        ctx2d.textAlign = 'left';
        ctx2d.fillStyle = '#ffaa00';
        ctx2d.fillText(isClipMode ? 'CLIPBOARD' : 'AUDIO', 8, barMidY);
      }

      // ── CMD bar text (drawn last, stays on top) ──────────────────────────
      ctx2d.fillStyle = COLOR_CMD_TEXT;
      ctx2d.font = '20px Monogram, monospace';
      ctx2d.textBaseline = 'middle';
      const cmdMidY = CMD_BAR_H / 2;
      ctx2d.textAlign = 'center';
      ctx2d.fillText(s.stepDivision, cmdEncoderSlotCenterX(0, w), cmdMidY);
      ctx2d.fillText('SCROLL', cmdEncoderSlotCenterX(7, w), cmdMidY);

      // ── Clipboard Modifier Action labels in CMD bar (slots 2-5) ──────────
      if (isClipMode) {
        const slotW = w / CMD_ENCODER_SLOT_COUNT;
        ctx2d.textAlign = 'center';
        // Slot 2 — VOL
        const volLabel = s.cbModVolDb === 0 ? '0 dB' : `${s.cbModVolDb} dB`;
        ctx2d.fillText(volLabel, slotW * 1.5, cmdMidY);
        // Slot 3 — PAN
        const panAbs = Math.abs(s.cbModPan);
        const panLabel = s.cbModPan === 0 ? '0 LR' : `${panAbs}${s.cbModPan < 0 ? 'L' : 'R'}`;
        ctx2d.fillText(panLabel, slotW * 2.5, cmdMidY);
        // Slot 4 — FADE (SHIFT toggles IN/OUT)
        ctx2d.fillText(s.shiftDown ? 'FADE IN' : 'FADE OUT', slotW * 3.5, cmdMidY);
        // Slot 5 — REVERSE
        ctx2d.fillText('REVERSE', slotW * 4.5, cmdMidY);
        // Slot 6 — SPEED
        const speedRatio = CB_SPEED_RATIOS[s.cbModSpeedIdx]!;
        const speedLabel = s.cbModSpeedIdx === CB_SPEED_NEUTRAL_IDX ? 'x1.0' : `x${speedRatio.toFixed(2)}`;
        ctx2d.fillText(speedLabel, slotW * 5.5, cmdMidY);
      }

      // ── Clipboard Mode: orange 2px outline around entire viewport ────────
      if (isClipMode) {
        ctx2d.strokeStyle = '#ffaa00';
        ctx2d.lineWidth = 2;
        ctx2d.strokeRect(1, 1, VISIBLE_WIDTH - 2, VISIBLE_HEIGHT - 2);
      }

      // Load error overlay
      if (s.loadError) {
        ctx2d.fillStyle = '#ff4444';
        ctx2d.font = '14px sans-serif';
        ctx2d.textAlign = 'left';
        ctx2d.textBaseline = 'alphabetic';
        ctx2d.fillText(s.loadError, 8, VISIBLE_HEIGHT - 8);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [applyGainImmediate, bumpUi]);

  const s = stateRef.current;
  const canUndo = undoStackRef.current.length > 0 && !s.clipboardMode;
  const canRedo = redoEntryRef.current !== null && !s.clipboardMode;

  return (
    <div className="app-container" data-ui-revision={uiTick}>
      <nav className="demo-nav" aria-label="Demo views">
        <NavLink
          to="/overview"
          end
          className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}
        >
          Main Overview
        </NavLink>
        <NavLink
          to="/piano"
          end
          className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}
        >
          Piano roll
        </NavLink>
        <NavLink
          to="/waveform"
          end
          className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}
        >
          Waveform
        </NavLink>
        <NavLink
          to="/timed-mute"
          end
          className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}
        >
          Timed Mute
        </NavLink>
      </nav>

      <div className="edit-actions">
        <button
          type="button"
          className={`edit-action-btn${s.shiftDown ? ' edit-action-btn--shift-modifier' : ''}`}
          title="CUT — selected track; hold Shift for all unmuted (Numpad 8 / Shift+Numpad 8)"
          onClick={(e) => handleCutCopy('cut', e.shiftKey)}
        >
          {s.shiftDown ? 'CUT ALL' : 'CUT'}
        </button>
        <button
          type="button"
          className={`edit-action-btn${s.shiftDown ? ' edit-action-btn--shift-modifier' : ''}`}
          title="COPY — selected track; hold Shift for all unmuted (Numpad 9 / Shift+Numpad 9)"
          onClick={(e) => handleCutCopy('copy', e.shiftKey)}
        >
          {s.shiftDown ? 'COPY ALL' : 'COPY'}
        </button>
        <button
          className="edit-action-btn"
          title="PASTE – overwrite audio at playhead from clipboard (Numpad −)"
          onClick={handlePaste}
        >
          PASTE
        </button>
        <button
          className="edit-action-btn"
          title="UNDO last CUT or PASTE"
          onClick={handleUndo}
          disabled={!canUndo}
        >
          UNDO
        </button>
        <button
          className="edit-action-btn"
          title="REDO last undone action"
          onClick={handleRedo}
          disabled={!canRedo}
        >
          REDO
        </button>
      </div>

      <div ref={viewportRef} className="waveform-viewport device-viewport">
        <canvas
          ref={canvasRef}
          width={VISIBLE_WIDTH}
          height={VISIBLE_HEIGHT}
          className="timed-mute-canvas"
          aria-label="Eight-track main overview"
          onPointerDown={onTimelinePointerDown}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onTimelinePointerUp}
          onPointerCancel={onTimelinePointerUp}
        />
        {/* Transparent overlay select for step-division picker, positioned over CMD bar left */}
        <select
          aria-label="Scroll step size"
          title="Scroll step size"
          style={{
            position: 'absolute',
            top: 0,
            left: cmdEncoderSlotCenterX(0) - 36,
            width: 72,
            height: CMD_BAR_H,
            opacity: 0,
            cursor: 'pointer',
            zIndex: 10,
          }}
          value={s.stepDivision}
          onChange={(e) => {
            stateRef.current.stepDivision = e.target.value as StepDivision;
            bumpUi();
          }}
        >
          {STEP_DIVISIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {transientToast !== null ? (
        <div
          className="transient-toast-overlay"
          role={transientToast.variant === 'error' ? 'alert' : 'status'}
          aria-live={transientToast.variant === 'error' ? 'assertive' : 'polite'}
        >
          <div
            className={
              transientToast.variant === 'success'
                ? 'transient-toast-box transient-toast-box--success'
                : 'transient-toast-box'
            }
          >
            {transientToast.message}
          </div>
        </div>
      ) : null}

      {s.clipboardMode ? (
        <div className="instructions">
          <strong>SPACE</strong>: ⏯ PLAY/PAUSE &ndash; <strong>ARROW-Keys or Mousewheel</strong>: ⏪︎ ⏩︎ scroll by step-size &ndash; <strong>Escape</strong>: exit Clipboard Overview &ndash; <strong>1–8</strong>: select track (exclusive) &ndash; <strong>SHIFT + 1–8</strong>: toggle multi-select<br />
          <strong>Numpad 8</strong>: CUT selection &ndash; <strong>Numpad 9</strong>: COPY selection &ndash; <strong>Numpad Minus</strong>: PASTE &ndash; <strong>F1</strong>–<strong>F9</strong>: Set step size (4/1, … 1/2, … 1/64).<br />
          <strong>Numpad 5</strong>: set selection start &ndash; <strong>Numpad 6</strong>: set selection end (cyan overlay; narrows range for modifier operations). Set start = end to clear.<br /><br />
          <strong>Modifier actions (CMD-bar): All modifier actions apply immediatly on click on selected tracks/selection-range. <br />
          </strong> Vol: drag <strong>0 dB</strong> to set volume reduction &ndash; Pan: drag <strong>0 LR</strong> to set pan &ndash; Fade: click <strong>FADE OUT</strong> (hold SHIFT for FADE IN) &ndash; Reverse: click <strong>REVERSE</strong> &ndash; Speed: drag <strong>x 1.0</strong> to set speedratio.<br />
          
          Click <strong>(◻◻◻◻◻◻◻◻)</strong> to exit <strong>Clipboard Overview</strong>.
        </div>
      ) : (
        <div className="instructions">
          <strong>SPACE</strong>: ⏯ PLAY/PAUSE &ndash; <strong>ARROW-Keys or Mousewheel </strong>: ⏪︎ ⏩︎ scroll by step-size &ndash; <strong>SHIFT+LEFT</strong>: ⏮ song start. &ndash; <strong>SHIFT + 1–8</strong>: mute/unmute (synced to bar while playing)<br />
          <strong>Numpad 7 or Mouseclick in Grid-Bar</strong> set ▼ marker (<strong>mouse-drag</strong> to move;  <strong>Shift+Numpad 7</strong> clear all). &ndash; <strong>F1</strong>–<strong>F9</strong>: Set step size (4/1, … 1/2, … 1/64).<br />
          <strong>Numpad 8</strong>: CUT segment &ndash; <strong>Numpad 9</strong>: COPY segment &ndash; <strong>Numpad Minus</strong>: PASTE &ndash; <strong>Shift+CUT/COPY</strong>: cut or copy all unmuted tracks.<br />
          <strong>Numpad 5</strong>: set loop start &ndash; <strong>Numpad 6</strong>: set loop end (green overlay; playhead wraps at end. Set loop-end to 0 to clear).<br />
          Click <strong> (◻◻◻◻◻◻◻◻) </strong> to open <strong>Clipboard Overview</strong>.
        </div>
      )}
    </div>
  );
};

export default MainOverviewPage;
