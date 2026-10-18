import { useEffect, useRef, useState } from 'react';
import { api, fmt } from '../lib/api';
import { useToast } from './Toast';

const SEEN_KEY = 'sst_notify_seen_orders';

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.stop(ctx.currentTime + 0.45);
  } catch (e) { /* ignore */ }
}

export default function OrderBell() {
  const [count, setCount] = useState(0);
  const seen = useRef(new Set());
  const firstRun = useRef(true);
  const toast = useToast();

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
      seen.current = new Set(Array.isArray(raw) ? raw : []);
    } catch { /* ignore */ }
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      try {
        const orders = await api('/orders?status=pending');
        const list = orders || [];
        setCount(list.length);
        if (firstRun.current) {
          list.forEach((o) => seen.current.add(o.id));
          firstRun.current = false;
        } else {
          const fresh = list.filter((o) => !seen.current.has(o.id));
          fresh.forEach((o) => {
            seen.current.add(o.id);
            toast(`New order ${o.order_number} : ${o.user_name} · ${fmt(o.total)}`, 'info');
          });
          if (fresh.length) beep();
        }
        try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen.current])); } catch { /* ignore */ }
      } catch (e) { /* ignore */ }
    };

    tick();
    // Event-driven only: the push channel fires chugaz-nudge the moment an
    // order is generated or its status changes, and focus/visibility catches
    // up whatever was missed while the stream was down. No timer polls.
    const onNudge = () => tick();
    const onWake = () => { if (!document.hidden) tick(); };
    window.addEventListener('chugaz-nudge', onNudge);
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      stopped = true;
      window.removeEventListener('chugaz-nudge', onNudge);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [toast]);

  if (!count) return null;
  return <span className="badge red nav-order-badge" title={`${count} pending online order${count === 1 ? '' : 's'}`}>{count}</span>;
}
