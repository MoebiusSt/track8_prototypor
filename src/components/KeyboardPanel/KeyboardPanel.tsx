/**
 * On-screen keyboard panel
 * Shows all keyboard shortcuts for controlling the device simulator.
 * Rendered below the device frame + function bar.
 */

import './KeyboardPanel.css';

interface KeyDef {
  key: string;          // displayed key label
  fn: string;           // function description
  color?: 'record' | 'play' | 'loop' | 'shift' | 'screen' | 'track' | 'encoder';
}

// ── Numpad section ────────────────────────────────────────────────────
const NUMPAD_ROWS: KeyDef[][] = [
  [
    { key: 'Num7', fn: '—' },
    { key: 'Num8', fn: '—' },
    { key: 'Num9', fn: '—' },
  ],
  [
    { key: 'Num4', fn: 'LOOP', color: 'loop' },
    { key: 'Num5', fn: 'LOOP ST', color: 'loop' },
    { key: 'Num6', fn: 'LOOP END', color: 'loop' },
  ],
  [
    { key: 'Num1', fn: '—' },
    { key: 'Num2', fn: '—' },
    { key: 'Num3', fn: '—' },
    { key: 'ENTER', fn: 'RECORD', color: 'record' },
  ],
  [
    { key: 'Num0', fn: 'SHIFT', color: 'shift' },
    { key: '  .  ', fn: 'PLAY', color: 'play' },
  ],
];

// ── Screen navigation ─────────────────────────────────────────────────
const NAV_KEYS: KeyDef[] = [
  { key: '←', fn: 'AUDIO VIEW', color: 'screen' },
  { key: '→', fn: 'SETTINGS', color: 'screen' },
];

// ── Track arm keys (1-8 on digit row) ────────────────────────────────
const TRACK_KEYS: KeyDef[] = Array.from({ length: 8 }, (_, i) => ({
  key: String(i + 1),
  fn: `TRK ${i + 1}`,
  color: 'track' as const,
}));

// ── F-key row (encoder press) ─────────────────────────────────────────
const F_KEYS: KeyDef[] = Array.from({ length: 8 }, (_, i) => ({
  key: `F${i + 1}`,
  fn: `ENC ${i + 1}`,
  color: 'encoder' as const,
}));

// ── Helper component for a single key ────────────────────────────────
function Key({ keyDef }: { keyDef: KeyDef }) {
  return (
    <div className={`kb-key ${keyDef.color ?? ''}`}>
      <span className="kb-key-label">{keyDef.key}</span>
      <span className="kb-key-fn">{keyDef.fn}</span>
    </div>
  );
}

export function KeyboardPanel() {
  return (
    <div className="keyboard-panel">
      <div className="kb-title">KEYBOARD CONTROLS</div>

      <div className="kb-sections">

        {/* ── Numpad ──────────────────────────────────── */}
        <div className="kb-section">
          <div className="kb-section-title">NUMPAD</div>
          <div className="kb-numpad">
            {NUMPAD_ROWS.map((row, ri) => (
              <div key={ri} className="kb-row">
                {row.map((k) => <Key key={k.key} keyDef={k} />)}
              </div>
            ))}
          </div>
        </div>

        {/* ── Divider ─────────────────────────────────── */}
        <div className="kb-divider" />

        {/* ── Right column: nav + tracks + f-keys ─────── */}
        <div className="kb-right-col">

          <div className="kb-section">
            <div className="kb-section-title">SCREEN NAVIGATION</div>
            <div className="kb-row">
              {NAV_KEYS.map((k) => <Key key={k.key} keyDef={k} />)}
            </div>
          </div>

          <div className="kb-section">
            <div className="kb-section-title">TRACK ARM  (digit row 1–8)</div>
            <div className="kb-row">
              {TRACK_KEYS.map((k) => <Key key={k.key} keyDef={k} />)}
            </div>
          </div>

          <div className="kb-section">
            <div className="kb-section-title">ENCODER PRESS  (F1–F8)</div>
            <div className="kb-row">
              {F_KEYS.map((k) => <Key key={k.key} keyDef={k} />)}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
