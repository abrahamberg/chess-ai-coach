import { COACH_PERSONAS, COACH_PERSONA_INFO, type CoachPersona } from '@chess-coach/shared';
import type { ReactNode } from 'react';
import './CoachPersonaSelect.css';

export interface CoachPersonaSelectProps {
  value: CoachPersona;
  onChange: (persona: CoachPersona) => void;
}

/** coaches.md: 7 cosmetic coach personas — the same coach, different voice.
 * "General Daniel" (the coach as it's always been) is the default. */
export function CoachPersonaSelect({ value, onChange }: CoachPersonaSelectProps): ReactNode {
  return (
    <div className="coach-persona-select" role="radiogroup" aria-label="Coach persona">
      {COACH_PERSONAS.map((persona) => {
        const info = COACH_PERSONA_INFO[persona];
        return (
          <label key={persona} className="coach-persona-select__option">
            <input
              type="radio"
              name="coach-persona"
              checked={value === persona}
              onChange={() => onChange(persona)}
            />
            <span className="coach-persona-select__avatar" aria-hidden="true">
              {info.avatar}
            </span>
            <span className="coach-persona-select__text">
              <span className="coach-persona-select__label">
                {info.label}
                {info.explicit && (
                  <span className="coach-persona-select__explicit" aria-label="Explicit" title="Explicit language">
                    E
                  </span>
                )}
              </span>
              <small className="coach-persona-select__tagline">{info.tagline}</small>
            </span>
          </label>
        );
      })}
    </div>
  );
}
