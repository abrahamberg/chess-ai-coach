import { RATING_BANDS, type RatingBand } from '@chess-coach/shared';
import type { ReactNode } from 'react';

export interface BandSelectProps {
  value: RatingBand;
  onChange: (band: RatingBand) => void;
}

const BAND_LABELS: Record<RatingBand, string> = {
  novice: 'New to chess',
  improving: 'Improving player',
  club: 'Club level',
  advanced: 'Advanced / competitive'
};

/** design.md §4.4: "rating band selector with the 4 bands described in plain
 * language" — never the raw enum value. */
export function BandSelect({ value, onChange }: BandSelectProps): ReactNode {
  return (
    <div role="radiogroup" aria-label="Rating band">
      {RATING_BANDS.map((band) => (
        <label key={band}>
          <input
            type="radio"
            name="rating-band"
            checked={value === band}
            onChange={() => onChange(band)}
          />
          {BAND_LABELS[band]}
        </label>
      ))}
    </div>
  );
}
