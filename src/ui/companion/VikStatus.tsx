/**
 * Inside the house: how he is doing, and what that changes.
 *
 * This is the one place the meter appears as a number rather than as a lit
 * window, because you came here to ask. The list underneath is the honest
 * part — it says what this band actually unlocks, so the meter is a thing you
 * can reason about rather than a mystery bar.
 *
 * The trophy shelf lands here too once there is a bond to put on it.
 */
import { Modal } from '../bits';
import { playableGames, type GameId } from '../../lib/companionGames';
import {
  BAND_BEHAVIOUR,
  BANDS,
  bandOf,
  baselineFor,
  type Band,
} from '../../lib/companionMood';

const BAND_LABEL: Record<Band, string> = {
  sulking: 'Sulking',
  grumpy: 'Grumpy',
  neutral: 'Content',
  happy: 'Happy',
  delighted: 'Delighted',
};

/** How each game's best reads. A reaction time is not a round count. */
const SCORE_LABEL: Partial<Record<GameId, (n: number) => string>> = {
  simon: (n) => `best ${n}`,
  blink: (n) => `best ${n}ms`,
  hide: (n) => `best ${n}s`,
};

interface Props {
  open: boolean;
  onClose: () => void;
  robotName: string;
  value: number;
  bondLevel: number;
  playful: boolean;
  onPlayful: (next: boolean) => void;
  /** Animation is allowed — games that need it are hidden when it is not. */
  animate: boolean;
  scores: Record<string, number>;
  onPlay: (id: GameId) => void;
}

export default function VikStatus({
  open,
  onClose,
  robotName,
  value,
  bondLevel,
  playful,
  onPlayful,
  animate,
  scores,
  onPlay,
}: Props) {
  const band = bandOf(value);
  const b = BAND_BEHAVIOUR[band];
  const baseline = baselineFor(bondLevel);

  return (
    <Modal open={open} onClose={onClose} title={`${robotName}'s place`}>
      <div className="vik-status">
        <p className="vik-status-blurb">{b.blurb}</p>

        <div className="vik-meter" data-band={band}>
          <div className="vik-meter-track">
            <div className="vik-meter-fill" style={{ width: `${value}%` }} />
            <div
              className="vik-meter-baseline"
              style={{ left: `${baseline}%` }}
              title={`Settles back to ${baseline}`}
            />
          </div>
          <div className="vik-meter-row">
            <strong>{BAND_LABEL[band]}</strong>
            <span className="vik-meter-num">{Math.round(value)}</span>
          </div>
        </div>

        <p className="vik-status-note">
          He drifts back to <strong>{baseline}</strong> on his own, so nothing here is
          permanent. Being kind raises where he settles; being unpleasant is the only thing
          that pushes him down.
        </p>

        <ul className="vik-status-list">
          <li>
            <span>Puts up with</span>
            <strong>{b.pokeTolerance} quick pokes</strong>
          </li>
          <li>
            <span>Starts things himself</span>
            <strong>{b.invites ? 'Yes' : 'Not in this mood'}</strong>
          </li>
          <li>
            <span>Things he does when idle</span>
            <strong>{b.antics.length || 'Nothing'}</strong>
          </li>
        </ul>

        <div className="vik-status-games">
          <h4>Play</h4>
          {playableGames(!animate).map((g) => {
            const best = scores[g.id];
            const label = best != null ? SCORE_LABEL[g.id]?.(best) : null;
            return (
              <button key={g.id} className="vik-play-item" onClick={() => onPlay(g.id)}>
                <span className="vik-play-label">
                  {g.label}
                  {label && <em>{label}</em>}
                </span>
                <span className="vik-play-blurb">{g.blurb}</span>
              </button>
            );
          })}
          {!animate && (
            <p className="vik-status-note">
              Some of his games need movement, so they are not listed while animation is
              off.
            </p>
          )}
        </div>

        <div className="vik-status-bands">
          {BANDS.map((x) => (
            <span key={x} className="vik-band-pip" data-band={x} data-on={x === band ? '1' : '0'}>
              {BAND_LABEL[x]}
            </span>
          ))}
        </div>

        <label className="vik-status-toggle">
          <input
            type="checkbox"
            checked={!playful}
            onChange={(e) => onPlayful(!e.target.checked)}
          />
          <span>
            Calm down — {robotName} keeps to himself and never starts anything.
          </span>
        </label>
      </div>
    </Modal>
  );
}
