import { useEffect, useState } from 'react';

// Image with graceful fallback: when src is missing or fails to load
// (e.g. /uploads/* files that don't exist on serverless hosting),
// render the fallback node instead of a broken-image icon.
export default function SafeImg({ src, alt = '', fallback = null, letter = 'P', ...imgProps }) {
  const [failed, setFailed] = useState(false);
  // A card can keep the same <img> while its photo changes (upload, capture,
  // set-as-main). Without this reset the first load error stuck forever and the
  // new, perfectly valid photo was never even attempted.
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) {
    if (fallback) return fallback;
    return <span style={{ fontWeight: 700, color: 'var(--muted)' }}>{letter}</span>;
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} {...imgProps} />;
}
