import React from 'react';

/**
 * Idle ambient indicator: a slowly spinning conic-gradient ring with a
 * gentle breathing pulse. Outer span owns rotation, inner span owns the
 * breathe transform so the two animations don't clobber a single transform.
 */
export function EnergyRing(): React.ReactElement {
  return (
    <span className="socratic-energy-ring" aria-hidden="true">
      <span className="socratic-energy-ring__inner" />
    </span>
  );
}
