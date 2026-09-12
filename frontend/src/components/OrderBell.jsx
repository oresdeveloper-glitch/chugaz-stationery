import { useEffect, useRef, useState } from 'react';
import { api, fmt } from '../lib/api';
import { useToast } from './Toast';

const SEEN_KEY = 'sst_notify_seen_orders';
const POLL_MS = 10000;

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
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [toast]);

  if (!count) return null;
  return <span className="badge red nav-order-badge" title={`${count} pending online order${count === 1 ? '' : 's'}`}>{count}</span>;
}
