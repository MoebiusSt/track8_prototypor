import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
/** Green bar height multiplier vs lane half-height (clamped to drawable range). */
const BAR_AMPLITUDE_SCALE = 1.28;
const POLY_Y_MIN = BASELINE_PAD + 8;
const POLY_Y_MAX = VISIBLE_HEIGHT - BASELINE_PAD - 8;
/** World X snap for lift stroke (px). New samples only when grid cell changes. */
const LIFT_GRID_X = 2;
/** Right-drag eraser radius (px, world). */
const ERASER_RADIUS_PX = 26;

function clampScroll(x: number): number {
  return Math.max(0, Math.min(MAX_SCROLL, Math.round(x)));
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

/** Initial polyline: max |y - mid| = this fraction of (half the drawable band). 0.5 → 50% of full swing. */
const INITIAL_POLY_AMPLITUDE_FRAC = 0.5;

function generatePolylineWorld(contentW: number, vh: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const top = BASELINE_PAD + 8;
  const bottom = vh - BASELINE_PAD - 8;
  const range = bottom - top;
  const midY = top + range * 0.5;
  const amp = (range * 0.5) * INITIAL_POLY_AMPLITUDE_FRAC;

  let x = 0;
  let y = midY;
  type Regime = 'calm' | 'wild';
  let regime: Regime = Math.random() < 0.55 ? 'wild' : 'calm';
  let regimeSegLeft = 0;

  while (x <= contentW) {
    pts.push({ x: Math.round(x), y: Math.round(y) });

    if (regimeSegLeft <= 0) {
      // Bias toward wild: higher point density, less long flat runs overall
      regime = Math.random() < 0.58 ? 'wild' : 'calm';
      regimeSegLeft =
        regime === 'calm'
          ? 5 + Math.floor(Math.random() * 16)
          : 8 + Math.floor(Math.random() * 26);
    }
    regimeSegLeft--;

    let stepX: number;
    let maxDY: number;

    if (regime === 'calm') {
      // Still visibly calm but not endless straight lines
      stepX = POLY_STEP * 2.2 + Math.random() * POLY_STEP * 9;
      maxDY = range * (0.014 + Math.random() * 0.028);
      if (Math.random() < 0.18) {
        stepX *= 0.65;
        maxDY *= 1.35;
      }
    } else {
      // High-frequency sampling, stronger vertical jitter within amp
      stepX = POLY_STEP * 0.18 + Math.random() * POLY_STEP * 1.15;
      maxDY = range * (0.055 + Math.random() * 0.14);
      if (Math.random() < 0.34) maxDY *= 1.5;
      if (Math.random() < 0.2) stepX *= 0.5;
    }

    y += (Math.random() - 0.5) * 2 * maxDY;
    y = Math.max(midY - amp, Math.min(midY + amp, y));
    x += stepX;
  }
  return pts;
}

function clampPolyY(y: number): number {
  return Math.max(POLY_Y_MIN, Math.min(POLY_Y_MAX, y));
}

function clampWorldX(x: number): number {
  return Math.max(0, Math.min(CONTENT_WIDTH, x));
}

function viewportToLogical(
  el: Element,
  clientX: number,
  clientY: number
): { lx: number; ly: number } {
  const r = el.getBoundingClientRect();
  const lx = ((clientX - r.left) / r.width) * VISIBLE_WIDTH;
  const ly = ((clientY - r.top) / r.height) * VISIBLE_HEIGHT;
  return { lx, ly };
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function snapLiftWorldX(wx: number): number {
  const c = clampWorldX(wx);
  return Math.round(c / LIFT_GRID_X) * LIFT_GRID_X;
}

/**
 * Vertical lift at world X: clamp X to polyline span, then set height to wy at that X.
 * Vertices keep strictly increasing X (graph of y over x) → no self-intersections.
 */
function liftPolylineAtX(
  poly: { x: number; y: number }[],
  gx: number,
  wy: number
): { x: number; y: number }[] {
  const y = Math.round(clampPolyY(wy));
  const n = poly.length;
  if (n < 2) return poly;

  if (gx < poly[0]!.x) {
    const c = poly.slice();
    c[0] = { x: c[0]!.x, y };
    return c;
  }
  if (gx > poly[n - 1]!.x) {
    const c = poly.slice();
    c[n - 1] = { x: c[n - 1]!.x, y };
    return c;
  }

  let i = 0;
  while (i + 1 < n && poly[i + 1]!.x < gx) i++;

  const a = poly[i]!;
  const b = poly[i + 1]!;

  if (a.x === gx) {
    const c = poly.slice();
    c[i] = { x: a.x, y };
    return c;
  }
  if (b.x === gx) {
    const c = poly.slice();
    c[i + 1] = { x: b.x, y };
    return c;
  }

  if (a.x < gx && gx < b.x) {
    return [...poly.slice(0, i + 1), { x: gx, y }, ...poly.slice(i + 1)];
  }

  return poly;
}

/** Right eraser: drop vertices inside radius (keep endpoints). */
function applyPolyEraser(
  poly: { x: number; y: number }[],
  wx: number,
  wy: number
): { x: number; y: number }[] {
  if (poly.length <= 2) return poly;
  const r2 = ERASER_RADIUS_PX * ERASER_RADIUS_PX;
  const last = poly.length - 1;
  const filtered = poly.filter((pt, i) => {
    if (i === 0 || i === last) return true;
    return distSq(pt.x, pt.y, wx, wy) > r2;
  });
  if (filtered.length < 2) {
    return [poly[0]!, poly[last]!];
  }
  return filtered;
}

export const WaveformPage: React.FC = () => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pendingLiftRef = useRef<{ gx: number; wy: number } | null>(null);
  const pendingEraseRef = useRef<{ wx: number; wy: number } | null>(null);
  const pointerRafRef = useRef<number | null>(null);

  const [scrollX, setScrollX] = useState(0);
  const [polylineOutline, setPolylineOutline] = useState(false);
  const [polyWorld, setPolyWorld] = useState<{ x: number; y: number }[]>(() =>
    generatePolylineWorld(CONTENT_WIDTH, VISIBLE_HEIGHT)
  );

  const amplitudes = useMemo(() => generateStereoAmplitudes(SAMPLE_COUNT), []);

  const barRects = useMemo(() => {
    const center = Math.round(VISIBLE_HEIGHT / 2);
    const maxHalf = center - BASELINE_PAD - 1;
    const x0 = 0;
    const x1 = VISIBLE_WIDTH;
    const colStart = Math.max(0, Math.floor((scrollX + x0) / BAR_PITCH));
    const colEnd = Math.min(SAMPLE_COUNT - 1, Math.ceil((scrollX + x1) / BAR_PITCH));
    const out: React.ReactElement[] = [];
    for (let col = colStart; col <= colEnd; col++) {
      const sx = col * BAR_PITCH - scrollX;
      if (sx + 2 <= x0 || sx >= x1) continue;
      const barX = Math.floor(sx);
      const hL = Math.max(1, Math.min(maxHalf, Math.round((amplitudes.l[col] ?? 0) * maxHalf * BAR_AMPLITUDE_SCALE)));
      const hR = Math.max(1, Math.min(maxHalf, Math.round((amplitudes.r[col] ?? 0) * maxHalf * BAR_AMPLITUDE_SCALE)));
      out.push(
        <rect
          key={`b-${col}-l`}
          className="waveform-svg__bar waveform-svg__bar--l"
          x={barX}
          y={center - hL}
          width={2}
          height={hL}
        />
      );
      out.push(
        <rect
          key={`b-${col}-r`}
          className="waveform-svg__bar waveform-svg__bar--r"
          x={barX}
          y={center + 1}
          width={2}
          height={hR}
        />
      );
    }
    return out;
  }, [scrollX, amplitudes]);

  const polyPointsAttr = useMemo(() => {
    if (polyWorld.length < 2) return '';
    return polyWorld.map((p) => `${p.x - scrollX},${p.y}`).join(' ');
  }, [polyWorld, scrollX]);

  const flushPendingPointerPoly = useCallback(() => {
    const lift = pendingLiftRef.current;
    const erase = pendingEraseRef.current;
    pendingLiftRef.current = null;
    pendingEraseRef.current = null;
    if (lift === null && erase === null) return;
    setPolyWorld((prev) => {
      let next = prev;
      if (lift) next = liftPolylineAtX(next, lift.gx, lift.wy);
      if (erase) next = applyPolyEraser(next, erase.wx, erase.wy);
      return next;
    });
  }, []);

  const schedulePointerPolyFlush = useCallback(() => {
    if (pointerRafRef.current !== null) return;
    pointerRafRef.current = requestAnimationFrame(() => {
      pointerRafRef.current = null;
      flushPendingPointerPoly();
    });
  }, [flushPendingPointerPoly]);

  useEffect(
    () => () => {
      if (pointerRafRef.current !== null) cancelAnimationFrame(pointerRafRef.current);
    },
    []
  );

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

  const scrollXRef = useRef(scrollX);
  scrollXRef.current = scrollX;

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    if (pointerRafRef.current !== null) {
      cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = null;
    }
    pendingLiftRef.current = null;
    pendingEraseRef.current = null;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    const { lx, ly } = viewportToLogical(svg, e.clientX, e.clientY);
    const wx = scrollXRef.current + lx;
    const wy = ly;
    if (e.button === 0) {
      const gx = snapLiftWorldX(wx);
      setPolyWorld((prev) => liftPolylineAtX(prev, gx, wy));
    } else {
      setPolyWorld((prev) => applyPolyEraser(prev, wx, wy));
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const { lx, ly } = viewportToLogical(svg, e.clientX, e.clientY);
    const wx = scrollXRef.current + lx;
    const wy = ly;
    if (e.buttons & 1) {
      e.preventDefault();
      pendingLiftRef.current = { gx: snapLiftWorldX(wx), wy };
      schedulePointerPolyFlush();
    }
    if (e.buttons & 2) {
      e.preventDefault();
      pendingEraseRef.current = { wx, wy };
      schedulePointerPolyFlush();
    }
  }, [schedulePointerPolyFlush]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (pointerRafRef.current !== null) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      flushPendingPointerPoly();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    },
    [flushPendingPointerPoly]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      pendingLiftRef.current = null;
      pendingEraseRef.current = null;
      if (pointerRafRef.current !== null) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    },
    []
  );

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
        <svg
          ref={svgRef}
          className="waveform-svg waveform-svg--edit"
          viewBox={`0 0 ${VISIBLE_WIDTH} ${VISIBLE_HEIGHT}`}
          width={VISIBLE_WIDTH}
          height={VISIBLE_HEIGHT}
          role="img"
          aria-label="Waveform demo"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(ev) => ev.preventDefault()}
        >
          <rect className="waveform-svg__bg" x={0} y={0} width={VISIBLE_WIDTH} height={VISIBLE_HEIGHT} />
          <g className="waveform-svg__bars">{barRects}</g>
          {polyPointsAttr ? (
            <>
              {polylineOutline && (
                <polyline
                  className="waveform-svg__poly waveform-svg__poly--outline"
                  fill="none"
                  points={polyPointsAttr}
                />
              )}
              <polyline
                className="waveform-svg__poly waveform-svg__poly--main"
                fill="none"
                points={polyPointsAttr}
              />
            </>
          ) : null}
          <rect
            className="waveform-svg__playhead"
            x={CURSOR_X}
            y={0}
            width={2}
            height={VISIBLE_HEIGHT}
          />
        </svg>
      </div>
      <div className="instructions">
        Horizontal scroll: Arrow Left / Arrow Right ({SCROLL_STEP}px steps). Left mouse button: DRAW curve. Right drag: erase points.
      </div>
    </div>
  );
};

export default WaveformPage;
