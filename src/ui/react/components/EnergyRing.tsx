import React from 'react';

interface EnergyRingProps {
  isActive?: boolean;
}

/**
 * Ambient indicator next to the Socratic brand title.
 *
 * - Idle (inactive): slowly spinning blue conic-gradient ring.
 * - Active (in-session): solid yellow circle to show the tutor is engaged.
 */
export function EnergyRing({ isActive }: EnergyRingProps): React.ReactElement {
  return (
    <span className={`socratic-energy-ring${isActive ? ' socratic-energy-ring--active' : ''}`} aria-hidden="true">
      <span className={`socratic-energy-ring__inner${isActive ? ' socratic-energy-ring__inner--active' : ''}`} />
    </span>
  );
}
