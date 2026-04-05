import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { VISIBLE_HEIGHT, VISIBLE_WIDTH } from '../viewportConstants';
import '../app.css';

/** Vite-resolved URLs for eight MP3 stems. */
const TRACK_URLS: string[] = Array.from({ length: 8 }, (_, i) =>
  new URL(`../assets/fonts/audio/track${i + 1}.mp3`, import.meta.url).href
);

const BPM = 120;
const BEATS_PER_BAR = 4;
const PIXELS_PER_BEAT = 40;
const PIXELS_PER_SECOND = (BPM / 60) * PIXELS_PER_BEAT; // 80
const SONG_DURATION_SEC = 70;
const SONG_WORLD_WIDTH = Math.round(SONG_DURATION_SEC * PIXELS_PER_SECOND); // 5600
const BAR_PITCH = 4;
const COLUMN_COUNT = Math.floor(SONG_WORLD_WIDTH / BAR_PITCH);
const CURSOR_X = Math.floor(VISIBLE_WIDTH / 2);

const TIMELINE_H = 20;
const TRACK_H = 44;
const LABELS_H = 28;
const TRACK_COUNT = 8;

const COLOR_LANE_BG = '#0d2818';
const COLOR_WAVE_NORMAL = '#dff1ff'; /** c8d8f0 */
const COLOR_WAVE_SELECTED = '#5aff5a';
const COLOR_WAVE_MUTED = '#3a4a60';
const COLOR_WAVE_MUTED_SEL = '#2a5a2a';
const COLOR_CURSOR = '#7fffff';
/** Upcoming synced mute/unmute marker (vertical line in track lanes); tweak independently of playhead. */
const COLOR_SYNC_UPCOMING_MARKER = '#ffaa00';
const COLOR_TRIANGLE = '#ffa034';
const COLOR_TICK_BEAT = '#6a9aaa';
const COLOR_TICK_BAR = '#9ec8d8';
const COLOR_LABEL_UNMUTED = '#ffaa00';
const COLOR_LABEL_MUTED = '#664400';
const BLINK_HZ = 4;
const REJECT_BLINK_HZ = 11;
const TIMELINE_DRAG_THRESHOLD_PX = 6;

type SyncMuteMode = 'OFF' | 'BEAT' | 'BAR' | 'BARS4' | 'BARS8' | 'MARKER';
type SyncInteractionMode = 'SIMPLE' | 'QUEUED';

const SYNC_MUTE_OPTIONS: { value: SyncMuteMode; label: string }[] = [
  { value: 'OFF', label: 'OFF' },
  { value: 'BEAT', label: 'BEAT' },
  { value: 'BAR', label: 'BAR' },
  { value: 'BARS4', label: '4 BARS' },
  { value: 'BARS8', label: '8 BARS' },
  { value: 'MARKER', label: 'MARKER' },
];

function beatDurationSec(): number {
  return 60 / BPM;
}

function barDurationSec(): number {
  return beatDurationSec() * BEATS_PER_BAR;
}

function nextSyncBoundarySongSec(currentSongSec: number, mode: SyncMuteMode): number {
  if (mode === 'OFF' || mode === 'MARKER') return currentSongSec;
  const beatDur = beatDurationSec();
  const barDur = barDurationSec();
  const divisor =
    mode === 'BEAT'
      ? beatDur
      : mode === 'BAR'
        ? barDur
        : mode === 'BARS4'
          ? barDur * 4
          : barDur * 8;
  const n = Math.ceil((currentSongSec + 1e-6) / divisor) * divisor;
  if (n >= SONG_DURATION_SEC - 1e-9) return SONG_DURATION_SEC;
  return n;
}

/** Wall-clock delta until next sync boundary from current song time (no safety margin). */
function deltaSecToNextBoundary(
  songNow: number,
  mode: SyncMuteMode,
  sortedMarkers: number[]
): number {
  if (mode === 'OFF') return Infinity;
  if (mode === 'MARKER') {
    const markers = sortedMarkers.length > 0 ? sortedMarkers : [0];
    const step = stepToNextMarkerLinear(songNow, markers);
    if (step === null) return Infinity;
    return Math.max(1e-4, step.delta);
  }
  let b = nextSyncBoundarySongSec(songNow, mode);
  let d = b - songNow;
  if (d <= 1e-5) {
    b = nextSyncBoundarySongSec(songNow + 1e-3, mode);
    d = b - songNow;
  }
  return Math.max(1e-4, d);
}

function getAllMarkersSorted(userMarkerSongSec: number[]): number[] {
  const u = userMarkerSongSec.filter((t) => t > 1e-6 && t < SONG_DURATION_SEC - 1e-6);
  const set = new Set<number>([0, ...u]);
  return Array.from(set).sort((a, b) => a - b);
}

function snapSongSecToBeat(t: number): number {
  const beatDur = beatDurationSec();
  const s = Math.round(t / beatDur) * beatDur;
  return Math.min(Math.max(0, s), SONG_DURATION_SEC - 1e-6);
}

/**
 * Next marker strictly after `pos` before song end (no loop wrap). Used for MARKER sync scheduling.
 */
function stepToNextMarkerLinear(
  pos: number,
  sorted: number[]
): { target: number; delta: number } | null {
  const eps = 1e-6;
  for (const m of sorted) {
    if (m > pos + eps && m < SONG_DURATION_SEC - eps) {
      return { target: m, delta: m - pos };
    }
  }
  return null;
}

/**
 * Next sync event must be at least one full beat away along the looped timeline (blocks sub-beat windows).
 * MARKER mode: walks markers strictly forward in song time (no wrap to next loop). Returns null if no marker
 * ahead with at least one beat lead before file end.
 */
function computeSafeSyncApply(
  songNow: number,
  mode: SyncMuteMode,
  sortedMarkers: number[]
): { deltaPlayback: number; boundarySongSec: number } | null {
  if (mode === 'OFF') {
    return { deltaPlayback: Infinity, boundarySongSec: songNow };
  }
  if (mode === 'MARKER') {
    const markers = sortedMarkers.length > 0 ? sortedMarkers : [0];
    const minLead = beatDurationSec();
    let pos = songNow;
    let total = 0;
    for (let i = 0; i < 256; i++) {
      const step = stepToNextMarkerLinear(pos, markers);
      if (step === null) {
        return null;
      }
      const { target, delta } = step;
      if (delta <= 1e-12) return null;
      total += delta;
      if (total >= minLead - 1e-6) {
        const boundarySongSec =
          target >= SONG_DURATION_SEC - 1e-9 ? SONG_DURATION_SEC : target;
        return { deltaPlayback: total, boundarySongSec };
      }
      pos = target + 1e-3;
      if (pos >= SONG_DURATION_SEC - 1e-9) {
        return null;
      }
    }
    return null;
  }
  const minLead = beatDurationSec();
  let pos = songNow;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    let b = nextSyncBoundarySongSec(pos, mode);
    let d = b - pos;
    if (d <= 1e-6) {
      b = nextSyncBoundarySongSec(pos + 1e-3, mode);
      d = b - pos;
    }
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
  return {
    deltaPlayback: fallback,
    boundarySongSec: fb >= SONG_DURATION_SEC - 1e-9 ? SONG_DURATION_SEC : fb,
  };
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

/** Playback seconds along the looped timeline from `fromSongSec` until `boundarySongSec` is reached. */
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

/** One queued sync mute: fixed musical boundary; wall-clock apply time set while transport runs. */
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
  preQueue: Set<number>;
  pending: Map<number, PendingSyncEntry>;
  syncMuteMode: SyncMuteMode;
  syncInteractionMode: SyncInteractionMode;
  shiftDown: boolean;
  /** User-placed timeline markers (song sec, beat-snapped); fixed marker at 0 is implicit. */
  userMarkerSongSec: number[];
  amplitudes: number[][] | null;
  loadError: string | null;
}

function isShiftCode(code: string): boolean {
  return code === 'ShiftLeft' || code === 'ShiftRight';
}

export const TimedMutePage: React.FC = () => {
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
    /** Tracks 1–8: default muted 1,4,5,7,8 (indices 0,3,4,6,7); audible 2,3,6. */
    muted: [true, false, false, true, true, false, true, true],
    selectedTrack: 0,
    preQueue: new Set(),
    pending: new Map(),
    syncMuteMode: 'OFF',
    syncInteractionMode: 'SIMPLE',
    shiftDown: false,
    userMarkerSongSec: [],
    amplitudes: null,
    loadError: null,
  });

  const [uiTick, setUiTick] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const syncMuteArmRef = useRef(false);
  const syncMuteWrapRef = useRef<HTMLDivElement | null>(null);
  /** Reject blink: rapid flash when sync cannot be scheduled (MARKER mode). */
  const rejectBlinkEndMsRef = useRef(0);
  const rejectBlinkTracksRef = useRef<Set<number>>(new Set());
  /** Timeline drag ghost song sec (beat-snapped); read in rAF. */
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

  const scrollXFromSongSec = (songSec: number): number =>
    songSec * PIXELS_PER_SECOND - CURSOR_X;

  const stopAllSources = useCallback(() => {
    const srcs = sourcesRef.current;
    if (!srcs) return;
    for (const src of srcs) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
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

  /** Set each pending entry's `applyAtAudioTime` from its stored boundary and current song position. */
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

  const clearPendingApplyTimesOnPause = useCallback(() => {
    for (const entry of stateRef.current.pending.values()) {
      entry.applyAtAudioTime = null;
    }
  }, []);

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
      const loopEnd = Math.min(SONG_DURATION_SEC, buf.duration);
      src.loopEnd = loopEnd;
      src.connect(gains[i]!);
      const offset = startSong % buf.duration;
      try {
        src.start(when, offset);
      } catch {
        src.start(when, 0);
      }
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
    clearPendingApplyTimesOnPause();
    bumpUi();
  }, [getSongSecNow, stopAllSources, clearPendingApplyTimesOnPause, bumpUi]);

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
      const applyAtAudioTime =
        ctx && s.playing ? ctx.currentTime + deltaPlayback : null;
      pending.set(trackIndex, {
        targetMuted: !s.muted[trackIndex],
        boundarySongSec,
        applyAtAudioTime,
      });
      bumpUi();
    },
    [getSongSecNow, bumpUi, triggerRejectBlink]
  );

  const commitPreQueueToPending = useCallback(() => {
    const s = stateRef.current;
    const pre = s.preQueue;
    if (pre.size === 0) return;
    const markers = getAllMarkersSorted(s.userMarkerSongSec);
    const applied = computeSafeSyncApply(getSongSecNow(), s.syncMuteMode, markers);
    if (applied === null) {
      triggerRejectBlink(Array.from(pre));
      return;
    }
    const { deltaPlayback, boundarySongSec } = applied;
    const ctx = audioCtxRef.current;
    const applyAtAudioTime =
      ctx && s.playing ? ctx.currentTime + deltaPlayback : null;
    const pending = s.pending;
    for (const trackIndex of pre) {
      const targetMuted = !s.muted[trackIndex];
      pending.set(trackIndex, { targetMuted, boundarySongSec, applyAtAudioTime });
    }
    pre.clear();
    bumpUi();
  }, [getSongSecNow, bumpUi, triggerRejectBlink]);

  const togglePreQueue = useCallback(
    (trackIndex: number) => {
      const s = stateRef.current;
      // Cancel a committed pending entry first (shift re-pressed after arm release).
      if (s.pending.has(trackIndex)) {
        s.pending.delete(trackIndex);
        rejectBlinkTracksRef.current.delete(trackIndex);
        bumpUi();
        return;
      }
      const pre = s.preQueue;
      if (pre.has(trackIndex)) {
        pre.delete(trackIndex);
        rejectBlinkTracksRef.current.delete(trackIndex);
      } else {
        pre.add(trackIndex);
      }
      bumpUi();
    },
    [bumpUi]
  );

  const onTimelinePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const ly = ((e.clientY - r.top) / r.height) * VISIBLE_HEIGHT;
      if (ly >= TIMELINE_H) return;
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
      markerDragGhostSecRef.current = snapSongSecToBeat(raw);
    },
    [getSongSecNow]
  );

  const onTimelinePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const st = timelinePointerRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* not captured */
        }
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
      const snapped = snapSongSecToBeat(raw);
      if (snapped <= 1e-4) return;
      const u = stateRef.current.userMarkerSongSec;
      if (u.some((t) => Math.abs(t - snapped) < 1e-4)) return;
      stateRef.current.userMarkerSongSec = [...u, snapped].sort((a, b) => a - b);
      bumpUi();
    },
    [getSongSecNow, bumpUi]
  );

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
    return () => {
      cancelled = true;
    };
  }, [bumpUi]);

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

  const setSyncMuteMode = useCallback(
    (mode: SyncMuteMode) => {
      stateRef.current.syncMuteMode = mode;
      if (mode === 'OFF') {
        stateRef.current.pending.clear();
        stateRef.current.preQueue.clear();
      } else if (stateRef.current.playing) {
        hydratePendingApplyTimes();
      }
      setSyncMenuOpen(false);
      bumpUi();
    },
    [hydratePendingApplyTimes, bumpUi]
  );

  const onSyncMuteTriggerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (syncMenuOpen) {
      setSyncMenuOpen(false);
      syncMuteArmRef.current = false;
      return;
    }
    syncMuteArmRef.current = true;
  }, [syncMenuOpen]);

  const onSyncMuteTriggerMouseUp = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (e.button !== 0) return;
    if (!syncMuteArmRef.current) return;
    syncMuteArmRef.current = false;
    setSyncMenuOpen(true);
  }, []);

  const onSyncMuteTriggerMouseLeave = useCallback(() => {
    syncMuteArmRef.current = false;
  }, []);

  useEffect(() => {
    if (!syncMenuOpen) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      const el = syncMuteWrapRef.current;
      if (el && !el.contains(ev.target as Node)) setSyncMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [syncMenuOpen]);

  const toggleSyncInteractionMode = useCallback(() => {
    stateRef.current.syncInteractionMode =
      stateRef.current.syncInteractionMode === 'SIMPLE' ? 'QUEUED' : 'SIMPLE';
    bumpUi();
  }, [bumpUi]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        void handlePlayClick();
        return;
      }

      const s = stateRef.current;
      s.shiftDown = e.shiftKey;

      if (isShiftCode(e.code)) {
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
            if (ctx) {
              anchorAudioTimeRef.current = ctx.currentTime;
              startPlayback();
            }
          }
          bumpUi();
          return;
        }
        const deltaBar = barDurationSec();
        const sign = e.key === 'ArrowLeft' ? -1 : 1;
        let next = getSongSecNow() + sign * deltaBar;
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

      const digit = e.code >= 'Digit1' && e.code <= 'Digit8' ? parseInt(e.code.slice(5), 10) - 1 : -1;
      const numpad =
        e.code >= 'Numpad1' && e.code <= 'Numpad8' ? parseInt(e.code.slice(6), 10) - 1 : -1;
      const trackIndex = digit >= 0 ? digit : numpad;

      if (trackIndex >= 0 && trackIndex < TRACK_COUNT) {
        if (e.shiftKey) {
          e.preventDefault();
          if (s.syncMuteMode === 'OFF') {
            toggleMuteImmediate(trackIndex);
            return;
          }
          if (s.syncInteractionMode === 'QUEUED') {
            togglePreQueue(trackIndex);
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
      const s = stateRef.current;
      s.shiftDown = e.shiftKey;
      if (s.syncMuteMode !== 'OFF' && s.syncInteractionMode === 'QUEUED') {
        commitPreQueueToPending();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    bumpUi,
    commitPreQueueToPending,
    getSongSecNow,
    startPlayback,
    stopAllSources,
    toggleMuteImmediate,
    togglePendingOrCancel,
    togglePreQueue,
    handlePlayClick,
  ]);

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
            if (
              entry.applyAtAudioTime !== null &&
              now + 1e-4 >= entry.applyAtAudioTime
            ) {
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
      const h = VISIBLE_HEIGHT;
      const nowPerf = performance.now();
      const blinkPhase = Math.floor((nowPerf / 1000) * BLINK_HZ) % 2 === 0;
      const rejectUntil = rejectBlinkEndMsRef.current;
      const rejectActive = nowPerf < rejectUntil;
      const rejectPhase = Math.floor((nowPerf / 1000) * REJECT_BLINK_HZ) % 2 === 0;
      if (!rejectActive && rejectBlinkTracksRef.current.size > 0) {
        rejectBlinkTracksRef.current.clear();
      }

      ctx2d.fillStyle = COLOR_LANE_BG;
      ctx2d.fillRect(0, 0, w, h);

      const beatDur = beatDurationSec();
      const firstBeat = Math.floor((scrollX / PIXELS_PER_SECOND) / beatDur);
      const lastBeat = Math.ceil(((scrollX + w) / PIXELS_PER_SECOND) / beatDur);

      ctx2d.fillStyle = '#061208';
      ctx2d.fillRect(0, 0, w, TIMELINE_H);

      for (let b = firstBeat; b <= lastBeat; b++) {
        const t = b * beatDur;
        const x = t * PIXELS_PER_SECOND - scrollX;
        if (x < -2 || x > w + 2) continue;
        const isBar = b % BEATS_PER_BAR === 0;
        ctx2d.strokeStyle = isBar ? COLOR_TICK_BAR : COLOR_TICK_BEAT;
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(x + 0.5, isBar ? 2 : 8);
        ctx2d.lineTo(x + 0.5, TIMELINE_H);
        ctx2d.stroke();
      }

      const amps = s.amplitudes;

      for (let tr = 0; tr < TRACK_COUNT; tr++) {
        const y0 = TIMELINE_H + tr * TRACK_H;
        ctx2d.fillStyle = COLOR_LANE_BG;
        ctx2d.fillRect(0, y0, w, TRACK_H);

        const centerY = y0 + TRACK_H / 2;
        const maxHalf = Math.floor(TRACK_H / 2) - 3;
        const x0 = 0;
        const x1 = w;

        if (amps?.[tr]) {
          const colStart = Math.max(0, Math.floor((scrollX + x0) / BAR_PITCH));
          const colEnd = Math.min(COLUMN_COUNT - 1, Math.ceil((scrollX + x1) / BAR_PITCH));
          const barW = 2;

          for (let col = colStart; col <= colEnd; col++) {
            const sx = col * BAR_PITCH - scrollX;
            if (sx + barW <= x0 || sx >= x1) continue;
            const amp = amps[tr]![col] ?? 0.02;
            const hBar = Math.max(1, Math.min(maxHalf, Math.round(amp * maxHalf * 1.2)));

            const muted = s.muted[tr]!;
            const sel = s.selectedTrack === tr;
            const pending = s.pending.has(tr);

            let fill = COLOR_WAVE_NORMAL;
            if (sel && !muted) fill = COLOR_WAVE_SELECTED;
            else if (sel && muted) fill = COLOR_WAVE_MUTED_SEL;
            else if (muted) fill = COLOR_WAVE_MUTED;

            /* QUEUED + Shift held: only orange numbers blink (preQueue), not waveforms. */
            const inRejectBlink = rejectActive && rejectBlinkTracksRef.current.has(tr);
            const waveformBlink = pending || inRejectBlink;
            const blinkUse = inRejectBlink ? rejectPhase : blinkPhase;
            if (waveformBlink && blinkUse) {
              fill =
                fill === COLOR_WAVE_SELECTED
                  ? COLOR_WAVE_MUTED_SEL
                  : fill === COLOR_WAVE_NORMAL
                    ? COLOR_WAVE_MUTED
                    : fill === COLOR_WAVE_MUTED_SEL
                      ? COLOR_WAVE_SELECTED
                      : COLOR_WAVE_NORMAL;
            }

            ctx2d.fillStyle = fill;
            ctx2d.fillRect(Math.floor(sx), centerY - hBar, barW, hBar);
            ctx2d.fillRect(Math.floor(sx), centerY + 1, barW, hBar);
          }
        }

        const pe = s.pending.get(tr);
        const showUpcomingSyncMarker = s.syncMuteMode !== 'OFF' && pe !== undefined;
        if (showUpcomingSyncMarker && pe) {
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

        ctx2d.strokeStyle = '#112818';
        ctx2d.beginPath();
        ctx2d.moveTo(0, y0 + TRACK_H - 0.5);
        ctx2d.lineTo(w, y0 + TRACK_H - 0.5);
        ctx2d.stroke();
      }

      ctx2d.strokeStyle = COLOR_CURSOR;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(CURSOR_X + 0.5, 0);
      ctx2d.lineTo(CURSOR_X + 0.5, TIMELINE_H + TRACK_COUNT * TRACK_H);
      ctx2d.stroke();

      const drawTimelineTriangle = (screenX: number, alpha: number) => {
        const sx = Math.round(screenX);
        if (sx < -10 || sx > w + 10) return;
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.fillStyle = COLOR_TRIANGLE;
        ctx2d.beginPath();
        ctx2d.moveTo(sx - 6, 2);
        ctx2d.lineTo(sx + 6, 2);
        ctx2d.lineTo(sx, 12);
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

      const labelY = TIMELINE_H + TRACK_COUNT * TRACK_H + Math.floor(LABELS_H * 0.65);
      ctx2d.font = 'bold 18px sans-serif';
      ctx2d.textAlign = 'center';

      for (let tr = 0; tr < TRACK_COUNT; tr++) {
        const cx = ((tr + 0.5) / TRACK_COUNT) * w;
        const muted = s.muted[tr]!;
        const preQ = s.preQueue.has(tr);
        const pending = s.pending.has(tr);
        let lab = muted ? COLOR_LABEL_MUTED : COLOR_LABEL_UNMUTED;

        const inRejectBlinkNum = rejectActive && rejectBlinkTracksRef.current.has(tr);
        const queuedArmed = s.syncInteractionMode === 'QUEUED' && s.shiftDown && preQ;
        const numberPendingBlink =
          pending && (s.syncInteractionMode === 'SIMPLE' || !s.shiftDown) && blinkPhase;

        if (inRejectBlinkNum) {
          lab = muted
            ? rejectPhase
              ? '#ffb84a'
              : COLOR_LABEL_MUTED
            : rejectPhase
              ? '#fff4dd'
              : COLOR_LABEL_UNMUTED;
        } else if (queuedArmed) {
          lab = muted
            ? blinkPhase
              ? '#ffb84a'
              : COLOR_LABEL_MUTED
            : blinkPhase
              ? '#886020'
              : COLOR_LABEL_UNMUTED;
        } else if (numberPendingBlink) {
          lab = muted ? '#443010' : '#886020';
        }

        ctx2d.fillStyle = lab;
        ctx2d.fillText(String(tr + 1), cx, labelY);
      }

      if (s.loadError) {
        ctx2d.fillStyle = '#ff4444';
        ctx2d.font = '14px sans-serif';
        ctx2d.textAlign = 'left';
        ctx2d.fillText(s.loadError, 8, h - 8);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [applyGainImmediate, bumpUi]);

  const s = stateRef.current;
  const syncOn = s.syncMuteMode !== 'OFF';

  return (
    <div className="app-container" data-ui-revision={uiTick}>
      <nav className="demo-nav" aria-label="Demo views">
        <NavLink
          to="/piano"
          end
          className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}
        >
          Piano roll
        </NavLink>
        <NavLink
          to="/"
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

      <div className="timed-mute-controls controls-bar">
        <button
          type="button"
          className={`timed-mute-btn-play${s.playing ? ' active' : ''}`}
          onClick={() => void handlePlayClick()}
          disabled={!audioReady}
        >
          {s.playing ? 'PAUSE' : 'PLAY'}
        </button>
        <div ref={syncMuteWrapRef} className="timed-mute-sync-wrap">
          <button
            type="button"
            className="timed-mute-btn-sync"
            aria-haspopup="listbox"
            aria-expanded={syncMenuOpen}
            onMouseDown={onSyncMuteTriggerMouseDown}
            onMouseUp={onSyncMuteTriggerMouseUp}
            onMouseLeave={onSyncMuteTriggerMouseLeave}
          >
            SYNC MUTE: {s.syncMuteMode}
          </button>
          {syncMenuOpen ? (
            <ul className="timed-mute-sync-menu" role="listbox" aria-label="Sync mute timing">
              {SYNC_MUTE_OPTIONS.map((opt) => (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.syncMuteMode === opt.value}
                    className={
                      s.syncMuteMode === opt.value ? 'timed-mute-sync-menu__item active' : 'timed-mute-sync-menu__item'
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseUp={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.button !== 0) return;
                      setSyncMuteMode(opt.value);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          className="timed-mute-btn-sync-mode"
          onClick={toggleSyncInteractionMode}
          disabled={!syncOn}
          title={syncOn ? 'Toggle SIMPLE vs QUEUED sync mute' : 'Enable a sync mute mode first'}
        >
          SYNC MODE: {s.syncInteractionMode}
        </button>
      </div>

      <div className="waveform-viewport device-viewport">
        <canvas
          ref={canvasRef}
          width={VISIBLE_WIDTH}
          height={VISIBLE_HEIGHT}
          className="timed-mute-canvas"
          aria-label="Eight-track waveform overview"
          onPointerDown={onTimelinePointerDown}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onTimelinePointerUp}
          onPointerCancel={onTimelinePointerUp}
        />
      </div>

      <div className="instructions">
        <strong>SPACE</strong>: ⏯ PLAY/PAUSE – <strong>SHIFT + 1–8</strong>: mute/unmute – <strong>ARROW-Keys</strong>: ⏪︎ ⏩︎ ±1 bar – <strong>SHIFT+LEFT</strong>: ⏮ song start. <br></br>
        <strong>Top timeline</strong>: set ▼ markers (<strong>click</strong> add/remove; <strong>drag</strong> to move). <br></br>
        "SYNC MARKER": syncs only at ▼ markers; Invalid: no more markers ahead DENIES and rapid-blinks the track.
      </div>

      <details className="algo-details">
        <summary>Timed Mute / Unmute — Logic Reference</summary>
        <pre className="algo-description">{`\
TIMED MUTE / UNMUTE — DEVELOPER LOGIC REFERENCE
================================================

PURPOSE
-------
N independent mute states per track. When a sync mode is active, mute/unmute
changes are deferred to a future musical boundary instead of taking effect
immediately.


ABSTRACT STATE
--------------
syncMuteMode      ∈ { OFF, BEAT, BAR, 4BARS, 8BARS, MARKER }
syncInteractionMode ∈ { SIMPLE, QUEUED } at their discretion

Per track k:
  muted[k]         boolean
  pending[k]?      { targetMuted, boundary (song-position), applyTime (wall-clock, null if stopped) }

Global:
  preQueue         set of track indices  (QUEUED mode, arm held only)
  rejectBlink      set of track indices + expiry timestamp


ABSTRACT EVENTS  (host maps these to its own input scheme)
---------------
ImmediateMuteToggle(k)   — only valid when syncMuteMode == OFF
SyncAction(k)            — sync ON + modifier + track k
SyncArmActive            — momentary modifier pressed (QUEUED mode only)
SyncArmReleased          — modifier released (QUEUED mode only)


PSEUDOCODE
----------
OnImmediateMuteToggle(k):
  if syncMuteMode == OFF: muted[k] ^= 1

OnSyncAction(k):
  if QUEUED and SyncArmActive:           // arm held: collect or cancel phase
    if pending[k] exists:                // cancel a previously committed entry
      remove pending[k]; return
    toggle preQueue[k]; return           // add or remove from arm set
  if pending[k] exists:                  // second press = cancel (SIMPLE, or QUEUED arm released)
    remove pending[k]; return
  tryScheduleSingle(k)                   // SIMPLE, or QUEUED without arm

tryScheduleSingle(k):
  b = nextEligibleBoundary(transportNow, syncMuteMode, userMarkers)
  if b == DENY: rejectBlink({k}); return
  pending[k] = { targetMuted: !muted[k], boundary: b,
                 applyTime: transportNow + delta (null if stopped) }

OnSyncArmReleased():             // QUEUED only
  if preQueue is empty: return
  // ONE shared boundary for the entire batch — key distinction vs SIMPLE
  // (SIMPLE computes an individual boundary per track at the time of each press)
  b = nextEligibleBoundary(transportNow, syncMuteMode, userMarkers)
  if b == DENY: rejectBlink(preQueue); preQueue unchanged; return
  for k in preQueue:
    pending[k] = { targetMuted: !muted[k], boundary: b, applyTime: ... }
  preQueue.clear()

OnTransportTick():
  for k with pending[k]:
    if applyTime != null and now >= applyTime:
      muted[k] = pending[k].targetMuted; remove pending[k]

OnTransportStop():
  for k with pending[k]: pending[k].applyTime = null   // keep boundary

OnTransportStart():
  for k with pending[k]:                               // recalculate wall-clock
    pending[k].applyTime = now + timeUntil(transportNow, pending[k].boundary)

OnSyncMuteModeChange(OFF):
  pending.clear(); preQueue.clear()


DENY CONDITION
--------------
nextEligibleBoundary(transportNow, mode, markers) is a host-specific black box.
It must enforce a minimum lead time of at least one beat before the boundary fires.

Grid modes (BEAT / BAR / 4BARS / 8BARS):
  Structurally never DENY — there is always a next grid boundary.

MARKER mode only:
  DENY when no user-placed marker exists strictly ahead of the current transport
  position before song end. No wrap to the next loop iteration is attempted,
  although further logic COULD check if loop mode is ON and then wrap and
  mute/unmute at song start marker. (at your discretion)

  → Placed marker ahead: OK.
  → No marker ahead:      DENY + reject blink on the requested track(s).


VISUAL FEEDBACK
---------------
┌──────────────────────────────────────────────────┬──────────────────────┬──────────────────┐
│ Condition                                        │ Track content        │ Track label      │
├──────────────────────────────────────────────────┼──────────────────────┼──────────────────┤
│ pending[k] active (SIMPLE or arm not held)       │ slow blink  (~4 Hz)  │ slow blink       │
│ preQueue[k] (QUEUED, arm held, not committed)    │ no change            │ slow blink only  │
│ rejectBlink[k] active                            │ rapid blink (~11 Hz) │ rapid blink      │
│                                                  │ duration ~450 ms     │ duration ~450 ms │
│ Sync OFF / idle                                  │ steady               │ steady           │
└──────────────────────────────────────────────────┴──────────────────────┴──────────────────┘

Positional marker: each track with a pending entry shows a visual indicator
(e.g. a line) at the position corresponding to remaining time until boundary.
No such marker for preQueue entries — they are not yet committed to a boundary.


MERMAID DIAGRAMS  (copy into https://mermaid.live or any Mermaid viewer)
----------------

── State machine: single track ──────────────────────────────────────────────

stateDiagram-v2
  [*] --> Idle
  Idle --> Pending : SyncAction(k) / trySchedule → OK
  Idle --> PreQueued : SyncAction(k) / QUEUED+arm held
  Pending --> Idle : SyncAction(k) again → cancel
  Pending --> Idle : SyncAction(k) / QUEUED+arm held → cancel
  Pending --> Idle : OnTransportTick boundary reached → apply muted[k]
  PreQueued --> Idle : SyncAction(k) again → dequeue
  PreQueued --> Pending : SyncArmReleased → commitBatch → OK
  PreQueued --> Idle : SyncArmReleased → commitBatch → DENY\\n[RejectFlash]
  Idle --> Idle : SyncAction(k) / trySchedule → DENY\\n[RejectFlash]

── Decision tree: OnSyncAction(k) ───────────────────────────────────────────

flowchart TD
  A([SyncAction k]) --> B{QUEUED and\\nSyncArmActive?}
  B -- yes --> C{pending k\\nexists?}
  C -- yes --> D[Cancel: remove pending k]
  C -- no --> E[Toggle preQueue k]
  B -- no --> F{pending k\\nexists?}
  F -- yes --> G[Cancel: remove pending k]
  F -- no --> H[tryScheduleSingle k]
  H --> I{nextEligibleBoundary\\nreturns DENY?}
  I -- yes --> J[rejectBlink track k\\nno pending set]
  I -- no --> K[Set pending k\\nboundary + applyTime]
`}</pre>
      </details>
    </div>
  );
}

export default TimedMutePage;
