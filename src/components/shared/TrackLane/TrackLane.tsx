/**
 * Single audio track lane – draws waveform on an HTML canvas.
 * Each bar is 2px wide, symmetric above/below center.
 * Colors follow the Dark theme from the Theme Editor.
 */

import { useRef, useEffect } from 'react';
import type { Track } from '../../../types/device';
import './TrackLane.css';

interface TrackLaneProps {
  track: Track;
}

/** Cheap but deterministic value [0, 1) based on integer seed */
function lcg(seed: number): number {
  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;
  return ((a * seed + c) % m) / m;
}

/** Generates a symmetric waveform bar amplitude [0, 1] for a given track + bar index */
function waveAmplitude(trackId: number, barIdx: number, hasContent: boolean): number {
  if (!hasContent) {
    // Near-flat: tiny noise
    return lcg(trackId * 999983 + barIdx) * 0.04 + 0.01;
  }
  // Multi-frequency wave + noise
  const s = trackId * 7919 + barIdx;
  const base =
    Math.abs(Math.sin(s * 0.031) * 0.55 +
             Math.sin(s * 0.073) * 0.25 +
             Math.sin(s * 0.173) * 0.12 +
             lcg(s) * 0.08);
  return Math.min(1.0, base * 1.15);
}

export function TrackLane({ track }: TrackLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.width;   // 1280
    const H = canvas.height;  // 45

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Background ───────────────────────────────────────────────
    ctx.fillStyle = '#272822';
    ctx.fillRect(0, 0, W, H);

    // ── Choose waveform color ────────────────────────────────────
    let color: string;
    if (track.armed) {
      color = '#f92672';   // recording red
    } else if (track.muted && track.soloed) {
      color = '#668c1c';   // muted + selected = dark green
    } else if (track.soloed) {
      color = '#a6e22e';   // selected / soloed = bright green
    } else if (track.muted) {
      color = '#75715e';   // muted gray
    } else if (track.hasContent) {
      color = '#f8f8f2';   // normal white
    } else {
      color = '#75715e';   // empty / gray
    }

    ctx.fillStyle = color;

    // ── Waveform bars: 2px wide, 1px gap ────────────────────────
    const BAR_W = 2;
    const GAP = 1;
    const STEP = BAR_W + GAP;
    const numBars = Math.floor(W / STEP);
    const cx = H / 2;

    for (let i = 0; i < numBars; i++) {
      const amp = waveAmplitude(track.id, i, track.hasContent);
      const halfH = amp * cx * 0.9; // keep a tiny margin
      const x = i * STEP;
      ctx.fillRect(x, cx - halfH, BAR_W, halfH * 2);
    }

    // ── Centre line ──────────────────────────────────────────────
    ctx.fillStyle = 'rgba(248,248,242,0.15)';
    ctx.fillRect(0, Math.round(cx), W, 1);

  }, [track.id, track.armed, track.soloed, track.muted, track.hasContent]);

  return (
    <div className="track-lane">
      <canvas
        ref={canvasRef}
        width={1280}
        height={45}
        className="track-canvas"
      />
    </div>
  );
}
