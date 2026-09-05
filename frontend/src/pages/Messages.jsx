import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../lib/api';
import { useToast } from '../components/Toast';

export default function Messages() {
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const toast = useToast();

  const load = async () => {
    try {
      const res = await api('/messages');
      setMessages(res.messages || res);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const toggleRead = async (m) => {
    try {
      await api(`/messages/${m.id}/read`, { method: 'PUT', body: { is_read: !m.is_read } });
      setSelected({ ...m, is_read: !m.is_read });
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const remove = async (m) => {
    if (!confirm('Delete this message?')) return;
    await api(`/messages/${m.id}`, { method: 'DELETE' });
    if (selected?.id === m.id) setSelected(null);
    load();
  };

  const unread = messages.filter((m) => !m.is_read).length;

  return (
    <div>
      <div className="page-header">
        <h1>Customer messages</h1>
        {unread > 0 && <span className="badge red">{unread} unread</span>}
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          {messages.length === 0 && <div className="muted">No messages yet.</div>}
          {messages.map((m) => (
            <button key={m.id} onClick={() => setSelected(m)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, borderBottom: '1px solid var(--border)', background: m.is_read ? 'transparent' : 'rgba(59,130,246,0.06)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{m.name}</b><span className="muted small">{fmtDateTime(m.created_at)}</span>
              </div>
              <div className="small muted">{m.subject} · {m.email}</div>
              {!m.is_read && <span className="badge blue">new</span>}
            </button>
          ))}
        </div>
        {selected ? (
          <div className="card">
            <div className="card-header">
              <h3>{selected.subject}</h3>
              <button className="btn sm" onClick={() => { setSelected(null); load(); }}>x</button>
            </div>
            <div className="small muted">{selected.name} · {selected.email} · {fmtDateTime(selected.created_at)}</div>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 12, background: 'var(--bg)', padding: 12, borderRadius: 8 }}>{selected.message}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <a className="btn" href={`mailto:${selected.email}?subject=Re: ${selected.subject}`}>Reply by email</a>
              <button className="btn" onClick={() => toggleRead(selected)}>{selected.is_read ? 'Mark unread' : 'Mark read'}</button>
              <button className="btn danger" onClick={() => remove(selected)}>Delete</button>
            </div>
          </div>
        ) : (
          <div className="card muted" style={{ textAlign: 'center', padding: 40 }}>Select a message to read it.</div>
        )}
      </div>
    </div>
  );
}