import { memo } from 'react';

// Static glass and raster layers never filter the live text or input surface.
export const CrtEffects = memo(function CrtEffects() {
  return <div className="crt-overlay" aria-hidden="true"><div className="crt-raster"/><div className="crt-grain"/><div className="crt-glass"/><div className="crt-sweep"/></div>;
});
