/**
 * Top chrome on Audio Overview — matches manual: VOL/PAN, meters labels, T/B, SSD, selection.
 */

import { useDevice } from '../../../state/DeviceContext';
import './AudioOverviewHeader.css';

export function AudioOverviewHeader() {
  const { state } = useDevice();
  const sel = state.tracks[state.selectedTrackIndex];
  const clipLabel = sel ? `T${state.selectedTrackIndex + 1}` : '—';

  return (
    <header className="ao-header" aria-label="Audio overview status">
      <div className="ao-header__row ao-header__row--modes">
        <div className="ao-modes">
          <span className="ao-mode ao-mode--active">VOL</span>
          <span className="ao-mode">PAN</span>
          <span className="ao-mode ao-mode--dim">SCROLL</span>
        </div>
        <div className="ao-header__mid">
          <span className="ao-label ao-label--dim">IN</span>
          <span className="ao-value ao-meter-bar" aria-hidden />
          <span className="ao-label">CLIP</span>
          <span className="ao-value ao-value--box">{clipLabel}</span>
          <span className="ao-label">T</span>
          <span className="ao-value">{state.transport.timeDisplay}</span>
          <span className="ao-label">B</span>
          <span className="ao-value">{state.transport.barPosition}</span>
          <span className="ao-label">OUT</span>
          <span className="ao-value ao-meter-bar ao-meter-bar--out" aria-hidden />
        </div>
      </div>
      <div className="ao-header__row ao-header__row--meta">
        <span className="ao-meta">
          {state.storageUsed.toFixed(1)} / {state.storageTotal.toFixed(1)} GB
        </span>
        <span className="ao-meta ao-meta--dim">48k / 24</span>
        <span className={`ao-meta ao-stream ${state.transport.isPlaying ? 'ao-stream--on' : ''}`}>
          {state.transport.isPlaying ? 'STREAM' : 'IDLE'}
        </span>
        <span className="ao-selected">
          <span className="ao-label ao-label--dim">SEL</span>
          <span className="ao-selected-name">{sel?.name?.replace(/\s/g, '\u00A0') ?? '—'}</span>
        </span>
      </div>
    </header>
  );
}
