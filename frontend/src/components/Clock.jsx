import { useEffect, useState } from 'react';

// The header clocks used to live in page state, so a 1-second setState in the
// Dashboard/Layout re-rendered the entire dashboard (every chart and KPI) once
// a second, forever. Keeping the tick inside these leaf components means only
// the two text nodes update.
//
// The dashboard only prints hours:minutes, so it does not need a per-second
// timer; the shell clock does show seconds.

function useNow(intervalMs) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function DashClock() {
  const now = useNow(15000);
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeLabel = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return <span className="muted small">{dateLabel} · {timeLabel}</span>;
}

export function StaffClock() {
  const now = useNow(1000);
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <>
      <span className="staff-clock-time">{timeStr}</span>
      <span className="staff-clock-date">{dateStr}</span>
    </>
  );
}
