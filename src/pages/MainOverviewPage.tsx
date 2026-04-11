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
const COLOR_SYNC_UPCOMING_MARKER = '#ffaa00';
const COLOR_TRIANGLE = '#ffa034';
const COLOR_TICK_BEAT = '#6a9aaa';
const COLOR_TICK_BAR = '#9ec8d8';
const COLOR_LABEL_UNMUTED = '#ffaa00';
const COLOR_LABEL_MUTED = '#664400';
const COLOR_CMD_TEXT = '#ffa034';
const COLOR_BOTTOM_SQUARE = '#664400';
const BLINK_HZ = 4;
const REJECT_BLINK_HZ = 11;
const TIMELINE_DRAG_THRESHOLD_PX = 6;

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingSyncEntry {
  targetMuted: boolean;
  boundarySongSec: number;
  applyAtAudioTime: number | null;
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MainOverviewPage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<AudioBuffer[] | null>(null);
  const gainNodesRef = useRef<GainNode[] | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[] | null>(null);
  const rafRef = useRef<number | null>(null);
  const anchorAudioTimeRef = useRef(0);
  const anchorSongSecRef = useRef(0);

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
    stepDivision: '1/64',
  });

  const [uiTick, setUiTick] = useState(0);
  const [audioReady, setAudioReady] = useState(false);

  const rejectBlinkEndMsRef = useRef(0);
  const rejectBlinkTracksRef = useRef<Set<number>>(new Set());

  const markerDragGhostSecRef = useRef<number | null>(null);
  const markerDragSourceSecRef = useRef<number | null>(null);
  const timelinePointerRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    kind: 'empty' | 'userMarker';
    sourceSec?: number;
    dragActive: boolean;
  } | null>(null);

  const bumpUi = useCallback(() => setUiTick((t) => t + 1), []);

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

  // Timeline pointer: only active in GRID zone (y: CMD_BAR_H … TRACKS_Y0)
  const onTimelinePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const ly = ((e.clientY - r.top) / r.height) * VISIBLE_HEIGHT;
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
    [getSongSecNow]
  );

  const onTimelinePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    [getSongSecNow]
  );

  const onTimelinePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    [getSongSecNow, bumpUi]
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
    if (stateRef.current.playing) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }, [audioReady, ensureAudioGraph, pausePlayback, startPlayback]);

  // Keyboard input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        void handlePlayClick();
        return;
      }

      const s = stateRef.current;
      s.shiftDown = e.shiftKey;

      if (isShiftCode(e.code)) {
        // bumpUi so bottom-bar switches to track-number display immediately
        bumpUi();
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
        const delta = stepDivisionToSec(s.stepDivision);
        const sign = e.key === 'ArrowLeft' ? -1 : 1;
        let next = getSongSecNow() + sign * delta;
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
        return;
      }

      const digit =
        e.code >= 'Digit1' && e.code <= 'Digit8' ? parseInt(e.code.slice(5), 10) - 1 : -1;
      const numpad =
        e.code >= 'Numpad1' && e.code <= 'Numpad8' ? parseInt(e.code.slice(6), 10) - 1 : -1;
      const trackIndex = digit >= 0 ? digit : numpad;

      if (trackIndex >= 0 && trackIndex < TRACK_COUNT) {
        if (e.shiftKey) {
          e.preventDefault();
          // When song is stopped: always immediate mute (no cue, no blink, no marker)
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
      stateRef.current.shiftDown = e.shiftKey;
      bumpUi();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    bumpUi,
    getSongSecNow,
    handlePlayClick,
    startPlayback,
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

      const scrollX = scrollXFromSongSec(songSec);
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

      // ── Track lanes ─────────────────────────────────────────────────────
      const amps = s.amplitudes;
      for (let tr = 0; tr < TRACK_COUNT; tr++) {
        const y0 = TRACKS_Y0 + tr * TRACK_H;
        ctx2d.fillStyle = COLOR_LANE_BG;
        ctx2d.fillRect(0, y0, w, TRACK_H);

        const centerY = y0 + Math.floor(TRACK_H / 2);
        // Centerline occupies ±2px around centerY; subtract that from usable amplitude space
        const maxHalf = Math.floor(TRACK_H / 2) - 4;

        // Track-level state (needed for both centerline and amplitude bars)
        const muted = s.muted[tr]!;
        const sel = s.selectedTrack === tr;
        const hasPending = s.pending.has(tr);

        // Base track color (reflects muted/selected state, no blink)
        let baseColor = COLOR_WAVE_NORMAL;
        if (sel && !muted) baseColor = COLOR_WAVE_SELECTED;
        else if (sel && muted) baseColor = COLOR_WAVE_MUTED_SEL;
        else if (muted) baseColor = COLOR_WAVE_MUTED;

        // Blink state for bars (not applied to centerline)
        const inRejectBlink = rejectActive && rejectBlinkTracksRef.current.has(tr);
        const waveformBlink = hasPending || inRejectBlink;
        const blinkUse = inRejectBlink ? rejectPhase : blinkPhase;

        if (amps?.[tr]) {
          const colStart = Math.max(0, Math.floor(scrollX / BAR_PITCH));
          const colEnd = Math.min(COLUMN_COUNT - 1, Math.ceil((scrollX + w) / BAR_PITCH));
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
            // Bars grow outward from the centerline edges (±2px)
            ctx2d.fillRect(Math.floor(sx), centerY - 2 - hBar, barW, hBar);
            ctx2d.fillRect(Math.floor(sx), centerY + 2, barW, hBar);
          }
        }

        // Centerline drawn AFTER bars: always static baseColor, never blinks.
        // 2×4px blocks, 2px gap, on the BAR_PITCH grid, covers full visible width
        // including negative time (left of song start) as a visual track axis.
        const clY = centerY - 2;
        ctx2d.fillStyle = baseColor;
        const clColStart = Math.floor(scrollX / BAR_PITCH) - 1;
        const clColEnd = Math.ceil((scrollX + w) / BAR_PITCH) + 1;
        for (let col = clColStart; col <= clColEnd; col++) {
          const clX = Math.floor(col * BAR_PITCH - scrollX);
          if (clX + 2 <= 0 || clX >= w) continue;
          ctx2d.fillRect(clX, clY, 2, 4);
        }

        // Upcoming sync-mute marker line
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
      }

      // ── Playhead cursor line ─────────────────────────────────────────────
      ctx2d.strokeStyle = COLOR_CURSOR;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(CURSOR_X + 0.5, CMD_BAR_H);
      ctx2d.lineTo(CURSOR_X + 0.5, TRACKS_Y0 + TRACK_COUNT * TRACK_H);
      ctx2d.stroke();

      // ── Timeline marker triangles ────────────────────────────────────────
      // Triangle: 24px wide (±12), 12px tall (top to tip)
      const drawTimelineTriangle = (screenX: number, alpha: number) => {
        const sx = Math.round(screenX);
        if (sx < -14 || sx > w + 14) return;
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.fillStyle = COLOR_TRIANGLE;
        ctx2d.beginPath();
        ctx2d.moveTo(sx - 12, CMD_BAR_H + 2);
        ctx2d.lineTo(sx + 12, CMD_BAR_H + 2);
        ctx2d.lineTo(sx, CMD_BAR_H + 14);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.restore();
      };

      // Playhead triangle at CURSOR_X
      drawTimelineTriangle(CURSOR_X, 1);

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

      if (s.shiftDown) {
        // Show track numbers with mute-state colors (visible while SHIFT held)
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
        // Show 8 squares + T mm:ss + B bars:beats
        const squareSize = 16;
        const squareGap = 3;
        const squaresStartX = Math.round(w * 0.12); // ~154px (~1/8 screen)
        const squareY = BOTTOM_BAR_Y + Math.floor((BOTTOM_BAR_H - squareSize) / 2);
        ctx2d.fillStyle = COLOR_BOTTOM_SQUARE;
        for (let i = 0; i < TRACK_COUNT; i++) {
          ctx2d.fillRect(squaresStartX + i * (squareSize + squareGap), squareY, squareSize, squareSize);
        }

        const totalSecInt = Math.floor(songSec);
        const mm = Math.floor(totalSecInt / 60).toString().padStart(2, '0');
        const ss = (totalSecInt % 60).toString().padStart(2, '0');
        const tStr = `T ${mm}:${ss}`;

        const totalBeats = Math.floor(songSec / beatDur);
        const bar = Math.floor(totalBeats / BEATS_PER_BAR); // 0-based: B 00:01 at time 0
        const beat = (totalBeats % BEATS_PER_BAR) + 1;
        const bStr = `B ${bar.toString().padStart(2, '0')}:${beat.toString().padStart(2, '0')}`;

        ctx2d.fillStyle = COLOR_CMD_TEXT;
        ctx2d.font = '20px Monogram, monospace';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(tStr, 480, barMidY);
        ctx2d.fillText(bStr, 680, barMidY);
      }

      // ── CMD bar text (drawn last, stays on top) ──────────────────────────
      ctx2d.fillStyle = COLOR_CMD_TEXT;
      ctx2d.font = '20px Monogram, monospace';
      ctx2d.textBaseline = 'middle';
      const cmdMidY = CMD_BAR_H / 2;
      ctx2d.textAlign = 'left';
      ctx2d.fillText(s.stepDivision, 8, cmdMidY);
      ctx2d.textAlign = 'right';
      ctx2d.fillText('SCROLL', w - 8, cmdMidY);

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

      <div className="waveform-viewport device-viewport">
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
            left: 0,
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

      <div className="instructions">
        <strong>SPACE</strong>: ⏯ PLAY/PAUSE &ndash; <strong>SHIFT + 1–8</strong>: mute/unmute (synced to bar while playing) &ndash; <strong>ARROW-Keys</strong>: ⏪︎ ⏩︎ scroll by step &ndash; <strong>SHIFT+LEFT</strong>: ⏮ song start.<br />
        <strong>Top timeline</strong>: set ▼ markers (<strong>click</strong> add/remove; <strong>drag</strong> to move). &ndash; <strong>Step size</strong>: click the division value top-left to change scroll step.
      </div>
    </div>
  );
};

export default MainOverviewPage;
