import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  BAR_PITCH,
  TOTAL_WIDTH,
  VISIBLE_HEIGHT,
  VISIBLE_WIDTH,
} from '../viewportConstants';
import '../app.css';
import '../waveform.css';

const SCROLL_STEP = 2;
const CONTENT_WIDTH = Math.floor(TOTAL_WIDTH / BAR_PITCH) * BAR_PITCH;
const SAMPLE_COUNT = Math.floor(CONTENT_WIDTH / BAR_PITCH);
const MAX_SCROLL = Math.max(0, CONTENT_WIDTH - VISIBLE_WIDTH);
const CURSOR_X = Math.floor(VISIBLE_WIDTH / 2) - 1;
const POLY_STEP = 8;
const BASELINE_PAD = 4;

const COLORS = {
  bg: '#0d2818',
  bar: '#7fff7f',
  orange: '#ff8800',
  outline: '#000000',
  cyan: '#7fffff',
} as const;

function clampScroll(x: number): number {
  return Math.max(0, Math.min(MAX_SCROLL, Math.round(x)));
}

function drawPixelClipped(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  clipW: number,
  clipH: number
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= clipW || yi < 0 || yi >= clipH) return;
  ctx.fillStyle = color;
  ctx.fillRect(xi, yi, 1, 1);
}

/** Integer grid Bresenham line (1px steps, no anti-aliasing). */
function strokeLineBresenham(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number,
  x1: number, y1: number,
  color: string,
  clipW: number, clipH: number
): void {
  let x0i = Math.round(x0);
  let y0i = Math.round(y0);
  const x1i = Math.round(x1);
  const y1i = Math.round(y1);
  const dx = Math.abs(x1i - x0i);
  const dy = Math.abs(y1i - y0i);
  const sx = x0i < x1i ? 1 : -1;
  const sy = y0i < y1i ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    drawPixelClipped(ctx, x0i, y0i, color, clipW, clipH);
    if (x0i === x1i && y0i === y1i) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0i += sx; }
    if (e2 < dx)  { err += dx; y0i += sy; }
  }
}

/** Collect Bresenham pixel coordinates within clip (for outline pass). */
function collectBresenhamPixels(
  x0: number, y0: number,
  x1: number, y1: number,
  clipW: number, clipH: number,
  into: Set<string>
): void {
  let x0i = Math.round(x0);
  let y0i = Math.round(y0);
  const x1i = Math.round(x1);
  const y1i = Math.round(y1);
  const dx = Math.abs(x1i - x0i);
  const dy = Math.abs(y1i - y0i);
  const sx = x0i < x1i ? 1 : -1;
  const sy = y0i < y1i ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (x0i >= 0 && x0i < clipW && y0i >= 0 && y0i < clipH) {
      into.add(`${x0i},${y0i}`);
    }
    if (x0i === x1i && y0i === y1i) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0i += sx; }
    if (e2 < dx)  { err += dx; y0i += sy; }
  }
}

const NEIGHBOR8: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** 1px Bresenham polyline; optional 1px black outline (8-neighbor ring outside the line). */
function drawPolylineBresenham(
  ctx: CanvasRenderingContext2D,
  polyWorld: { x: number; y: number }[],
  scroll: number,
  clipW: number,
  clipH: number,
  outline: boolean
): void {
  if (polyWorld.length < 2) return;

  if (!outline) {
    for (let i = 0; i < polyWorld.length - 1; i++) {
      const a = polyWorld[i]!;
      const b = polyWorld[i + 1]!;
      strokeLineBresenham(
        ctx,
        a.x - scroll, a.y,
        b.x - scroll, b.y,
        COLORS.orange,
        clipW,
        clipH
      );
    }
    return;
  }

  const linePixels = new Set<string>();
  for (let i = 0; i < polyWorld.length - 1; i++) {
    const a = polyWorld[i]!;
    const b = polyWorld[i + 1]!;
    collectBresenhamPixels(
      a.x - scroll, a.y,
      b.x - scroll, b.y,
      clipW,
      clipH,
      linePixels
    );
  }

  for (const key of linePixels) {
    const comma = key.indexOf(',');
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    for (const [dx, dy] of NEIGHBOR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= clipW || ny < 0 || ny >= clipH) continue;
      const nk = `${nx},${ny}`;
      if (!linePixels.has(nk)) {
        drawPixelClipped(ctx, nx, ny, COLORS.outline, clipW, clipH);
      }
    }
  }

  for (const key of linePixels) {
    const comma = key.indexOf(',');
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    drawPixelClipped(ctx, x, y, COLORS.orange, clipW, clipH);
  }
}

function generateStereoAmplitudes(count: number): { l: number[]; r: number[] } {
  const l: number[] = [];
  const r: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 24;
    const base = (Math.sin(t) * 0.35 + Math.sin(t * 0.31) * 0.25 + 1) * 0.5;
    l.push(Math.min(1, Math.max(0.02, base * 0.85 + Math.random() * 0.15)));
    r.push(Math.min(1, Math.max(0.02, base * 0.85 + Math.random() * 0.15)));
  }
  return { l, r };
}

function generatePolylineWorld(contentW: number, vh: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const top = BASELINE_PAD + 8;
  const bottom = vh - BASELINE_PAD - 8;
  const range = bottom - top;
  let x = 0;
  let y = top + range * 0.5;
  while (x <= contentW) {
    pts.push({ x: Math.round(x), y: Math.round(y) });
    // 30% chance of a longer flat run (32–96 px, tiny vertical drift)
    const flat = Math.random() < 0.3;
    const stepX = flat
      ? POLY_STEP * 4 + Math.random() * POLY_STEP * 8
      : POLY_STEP * 0.75 + Math.random() * POLY_STEP * 1.5;
    const maxDY = flat ? range * 0.04 : range * 0.38;
    y = Math.max(top, Math.min(bottom, y + (Math.random() - 0.5) * 2 * maxDY));
    x += stepX;
  }
  return pts;
}

function setupHiDpiCanvas(
  canvas: HTMLCanvasElement, logicalW: number, logicalH: number
): { ctx: CanvasRenderingContext2D; dpr: number } {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(logicalW * dpr);
  canvas.height = Math.round(logicalH * dpr);
  canvas.style.width = `${logicalW}px`;
  canvas.style.height = `${logicalH}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2d context');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return { ctx, dpr };
}

export const WaveformPage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [scrollX, setScrollX] = useState(0);
  const [polylineOutline, setPolylineOutline] = useState(false);

  const amplitudes = useMemo(() => generateStereoAmplitudes(SAMPLE_COUNT), []);
  const polyWorld = useMemo(() => generatePolylineWorld(CONTENT_WIDTH, VISIBLE_HEIGHT), []);

  const drawBars = useCallback((ctx: CanvasRenderingContext2D, scroll: number, x0: number, x1: number) => {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(x0, 0, x1 - x0, VISIBLE_HEIGHT);
    const center = Math.round(VISIBLE_HEIGHT / 2);
    const maxHalf = center - BASELINE_PAD - 1;
    const colStart = Math.max(0, Math.floor((scroll + x0) / BAR_PITCH));
    const colEnd = Math.min(SAMPLE_COUNT - 1, Math.ceil((scroll + x1) / BAR_PITCH));
    ctx.fillStyle = COLORS.bar;
    for (let col = colStart; col <= colEnd; col++) {
      const sx = col * BAR_PITCH - scroll;
      if (sx + 2 <= x0 || sx >= x1) continue;
      const barX = Math.floor(sx);
      const hL = Math.max(1, Math.round((amplitudes.l[col] ?? 0) * maxHalf));
      ctx.fillRect(barX, center - hL, 2, hL);
      const hR = Math.max(1, Math.round((amplitudes.r[col] ?? 0) * maxHalf));
      ctx.fillRect(barX, center + 1, 2, hR);
    }
  }, [amplitudes]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { ctx } = setupHiDpiCanvas(canvas, VISIBLE_WIDTH, VISIBLE_HEIGHT);
    drawBars(ctx, scrollX, 0, VISIBLE_WIDTH);
    drawPolylineBresenham(ctx, polyWorld, scrollX, VISIBLE_WIDTH, VISIBLE_HEIGHT, polylineOutline);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(CURSOR_X, 0, 2, VISIBLE_HEIGHT);
  }, [scrollX, polylineOutline, drawBars, polyWorld]);

  useLayoutEffect(() => { redraw(); }, [redraw]);
  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -SCROLL_STEP : SCROLL_STEP;
      setScrollX((prev) => clampScroll(prev + delta));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app-container">
      <nav className="demo-nav" aria-label="Demo views">
        <NavLink to="/" end className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}>
          Piano roll
        </NavLink>
        <NavLink to="/waveform" className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}>
          Waveform
        </NavLink>
      </nav>
      <div className="waveform-controls">
        <label>
          <input
            type="checkbox"
            checked={polylineOutline}
            onChange={(ev) => setPolylineOutline(ev.target.checked)}
          />
          Polyline black outline (1px)
        </label>
      </div>
      <div className="waveform-viewport device-viewport">
        <canvas ref={canvasRef} className="waveform-canvas" width={VISIBLE_WIDTH} height={VISIBLE_HEIGHT} aria-label="Waveform demo" />
      </div>
      <div className="instructions">
        Horizontal scroll: Arrow Left / Arrow Right ({SCROLL_STEP}px steps). Cyan line: playhead at viewport center.
      </div>
    </div>
  );
};

export default WaveformPage;
