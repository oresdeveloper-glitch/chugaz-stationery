import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import I from './icons';

const SEEN_KEY = 'sst_notify_seen_sales';

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

// Sales feed for managers/admins: toasts each new sale/order, keeps a dropdown history.
export default function SaleBell() {
  const [list, setList] = useState([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
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
        const res = await api('/notifications');
        const rows = (res && res.notifications) || [];
        setList(rows);
        setCount(res && res.unread_count ? res.unread_count : 0);
        if (firstRun.current) {
          rows.forEach((n) => seen.current.add(n.id));
          firstRun.current = false;
        } else {
          const fresh = rows.filter((n) => !n.is_read && !seen.current.has(n.id));
          fresh.forEach((n) => {
            seen.current.add(n.id);
            toast(`${n.title}${n.body ? ' — ' + n.body : ''}`, 'info');
          });
          if (fresh.length) {
            beep();
            try { window.dispatchEvent(new CustomEvent('chugaz-live', { detail: { kinds: fresh.map((n) => n.kind) } })); } catch (e) { /* ignore */ }
          }
        }
        try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen.current].slice(-300))); } catch { /* ignore */ }
      } catch (e) { /* ignore */ }
    };

    tick();
    // Event-driven only: the push channel fires chugaz-nudge the moment a
    // sale or order is generated on this instance (so a sale from another
    // till toasts even while this tab sits in the background, exactly like
    // the old ticker did), and focus/visibility catches up whatever was
    // missed while the stream was down. No timer polls the API.
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

  const markAllRead = async () => {
    try {
      await api('/notifications/read', { method: 'POST', body: {} });
      setCount(0);
      setList((l) => l.map((n) => ({ ...n, is_read: 1 })));
    } catch (e) { /* keep the badge; the next push refreshes the true state */ }
  };

  const toggle = () => {
    setOpen((v) => !v);
  };

  return (
    <div className="staff-bell-wrap">
      <button className="staff-bell" onClick={toggle} aria-label={`Sales notifications${count ? ` (${count} new)` : ''}`} title="Sales notifications">
        <I name="bell" size={18} />
        {count > 0 && <span className="badge red nav-order-badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="staff-bell-drop">
          <div className="staff-bell-head">
            <span>Sales feed</span>
            {count > 0 && <button className="staff-bell-clear" onClick={markAllRead}>Mark all read</button>}
          </div>
          <div className="staff-bell-list">
            {list.length === 0 ? (
              <div className="staff-bell-empty">No notifications yet — new sales and orders will appear here in real time.</div>
            ) : list.map((n) => (
              <div key={n.id} className={`staff-bell-item ${n.is_read ? '' : 'unread'}`}>
                <span className="staff-bell-item-title">{n.title}</span>
                {n.body && <span className="staff-bell-item-body">{n.body}</span>}
                <span className="staff-bell-item-time">{(n.created_at || '').slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
