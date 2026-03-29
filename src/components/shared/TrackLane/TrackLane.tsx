/**
 * Single audio track row: left gutter (index, IN/POST meters) + waveform canvas.
 */

import { useRef, useEffect, useCallback } from 'react';
import type { Track } from '../../../types/device';
import { useDevice } from '../../../state/DeviceContext';
import './TrackLane.css';

interface TrackLaneProps {
  track: Track;
  isSelected: boolean;
}

const WAVE_MIN_WIDTH = 1208;

/** Deterministic pseudo level 0..1 */
function meterLevel(trackId: number, which: 'in' | 'post'): number {
  const s = trackId * 31 + (which === 'in' ? 17 : 53);
  return 0.15 + (Math.sin(s * 0.7) * 0.5 + 0.5) * 0.75;
}

function lcg(seed: number): number {
  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;
  return ((a * seed + c) % m) / m;
}

function waveAmplitude(trackId: number, barIdx: number, hasContent: boolean): number {
  if (!hasContent) {
    return lcg(trackId * 999983 + barIdx) * 0.04 + 0.01;
  }
  const s = trackId * 7919 + barIdx;
  const base =
    Math.abs(Math.sin(s * 0.031) * 0.55 +
      Math.sin(s * 0.073) * 0.25 +
      Math.sin(s * 0.173) * 0.12 +
      lcg(s) * 0.08);
  return Math.min(1.0, base * 1.15);
}

export function TrackLane({ track, isSelected }: TrackLaneProps) {
  const { dispatch } = useDevice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const onSelectTrack = useCallback(() => {
    dispatch({ type: 'SELECT_TRACK', payload: track.id });
  }, [dispatch, track.id]);
  const inPct = meterLevel(track.id, 'in') * 100;
  const postPct = meterLevel(track.id, 'post') * 100;

  useEffect(() => {
    function paint() {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 2 || h < 2) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const W = w;
      const H = h;

      ctx.fillStyle = '#272822';
      ctx.fillRect(0, 0, W, H);

      let color: string;
      if (track.armed) {
        color = '#f92672';
      } else if (track.muted && track.soloed) {
        color = '#668c1c';
      } else if (track.soloed) {
        color = '#a6e22e';
      } else if (track.muted) {
        color = '#75715e';
      } else if (track.hasContent) {
        color = '#f8f8f2';
      } else {
        color = '#75715e';
      }

      ctx.fillStyle = color;

      const BAR_W = 2;
      const GAP = 1;
      const STEP = BAR_W + GAP;
      const numBars = Math.floor(W / STEP);
      const cx = H / 2;

      for (let i = 0; i < numBars; i++) {
        const amp = waveAmplitude(track.id, i, track.hasContent);
        const halfH = amp * cx * 0.9;
        const x = i * STEP;
        ctx.fillRect(x, cx - halfH, BAR_W, halfH * 2);
      }

      ctx.fillStyle = 'rgba(248,248,242,0.15)';
      ctx.fillRect(0, Math.round(cx), W, 1);
    }

    paint();

    const wrap = wrapRef.current;
    if (!wrap) return;

    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [track.id, track.armed, track.soloed, track.muted, track.hasContent]);

  return (
    <div
      className={`track-lane ${isSelected ? 'track-lane--selected' : ''} ${track.muted ? 'track-lane--muted' : ''}`}
      onClick={onSelectTrack}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectTrack();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Track ${track.id + 1}`}
    >
      <div className="track-gutter" aria-hidden>
        <span className="track-gutter__num">{track.id + 1}</span>
        <div className="track-gutter__meters">
          <div className="track-gutter__meter" title="Input level">
            <div className="track-gutter__meter-fill track-gutter__meter-fill--in" style={{ height: `${inPct}%` }} />
          </div>
          <div className="track-gutter__meter" title="Post FX level">
            <div
              className="track-gutter__meter-fill track-gutter__meter-fill--post"
              style={{ height: `${postPct}%` }}
            />
          </div>
        </div>
      </div>
      <div ref={wrapRef} className="track-wave-wrap" style={{ minWidth: `${WAVE_MIN_WIDTH}px` }}>
        <canvas ref={canvasRef} className="track-canvas" />
      </div>
    </div>
  );
}
