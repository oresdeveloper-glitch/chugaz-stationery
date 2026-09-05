import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { THEMES, applyTheme, getTheme } from '../theme';
import I from '../components/icons';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const toast = useToast();

  const load = async () => {
    try { setSettings(await api('/system/settings')); } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api('/system/settings', { method: 'PUT', body: settings });
      toast('Settings saved');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const backup = async () => {
    try {
      const res = await fetch('/api/system/backup', { headers: { Authorization: `Bearer ${localStorage.getItem('sst_token')}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stationery-backup-${Date.now()}.db`;
      a.click();
      toast('Backup downloaded');
    } catch (e) { toast(e.message, 'error'); }
  };

  const restore = async () => {
    if (!file) return toast('Choose a backup file first', 'error');
    if (!confirm('Restoring will overwrite the current database. Continue?')) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/system/restore', { method: 'POST', body: fd });
      toast('Database restored');
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const set = (k, v) => setSettings({ ...settings, [k]: v });

  const [theme, setTheme] = useState(getTheme());
  const pickTheme = (id) => {
    applyTheme(id);
    setTheme(id);
    api('/system/settings', { method: 'PUT', body: { app_theme: id } })
      .then(() => toast(`Theme updated everywhere`))
      .catch((e) => toast(e.message, 'error'));
  };

  return (
    <div>
      <div className="page-header"><h1>Settings</h1></div>
      <div className="grid grid-2">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Appearance</h2>
          <p className="muted">Choose a theme : applied instantly to the whole system and remembered on this device.</p>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} className={`theme-card${theme === t.id ? ' on' : ''}`} onClick={() => pickTheme(t.id)}>
                <span className="theme-mock" style={{ background: t.bg, color: t.text }}>
                  <span className="tm-side" style={{ background: t.dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)' }}>
                    <span className="tm-dot" style={{ background: t.primary }} />
                    <span className="tm-line" style={{ background: t.dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)' }} />
                    <span className="tm-line short" style={{ background: t.dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }} />
                  </span>
                  <span className="tm-main">
                    <span className="tm-line w70" style={{ background: t.dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.24)' }} />
                    <span className="tm-line" style={{ background: t.dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)' }} />
                    <span className="tm-btn" style={{ background: t.accent }} />
                  </span>
                </span>
                <span className="theme-card-foot">
                  <span className="tm-name">{t.label}</span>
                  {theme === t.id && <span className="tm-check"><I name="check" size={11} /></span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Shop details</h2>
          <div className="field"><label>Shop name</label><input value={settings.shop_name || ''} onChange={(e) => set('shop_name', e.target.value)} /></div>
          <div className="field"><label>Address</label><input value={settings.shop_address || ''} onChange={(e) => set('shop_address', e.target.value)} /></div>
          <div className="form-row">
            <div className="field"><label>Phone</label><input value={settings.shop_phone || ''} onChange={(e) => set('shop_phone', e.target.value)} /></div>
            <div className="field"><label>Email</label><input value={settings.shop_email || ''} onChange={(e) => set('shop_email', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Currency</label><input value={settings.currency || ''} onChange={(e) => set('currency', e.target.value)} /></div>
            <div className="field"><label>Allow negative stock</label>
              <select value={settings.allow_negative_stock || '0'} onChange={(e) => set('allow_negative_stock', e.target.value)}>
                <option value="0">No (recommended)</option><option value="1">Yes</option>
              </select>
            </div>
          </div>
          <h2 style={{ marginTop: 14 }}>CHUGAZ STATIONERY</h2>
          <div className="form-row">
            <div className="field"><label>Delivery fee</label><input type="number" value={settings.delivery_fee ?? ''} onChange={(e) => set('delivery_fee', e.target.value)} /></div>
            <div className="field"><label>Free delivery over</label><input type="number" value={settings.free_delivery_threshold ?? ''} onChange={(e) => set('free_delivery_threshold', e.target.value)} placeholder="0 = no free delivery" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Allow pickup</label>
              <select value={settings.pickup_available || '0'} onChange={(e) => set('pickup_available', e.target.value)}>
                <option value="0">No</option><option value="1">Yes</option>
              </select>
            </div>
            <div className="field"><label>Lipa Namba ya Vodacom (M-Pesa)</label><input value={settings.payment_instructions || ''} onChange={(e) => set('payment_instructions', e.target.value)} placeholder="e.g. 512345" /></div>
          </div>
          <div className="field"><label>Receipt footer</label><input value={settings.receipt_footer || ''} onChange={(e) => set('receipt_footer', e.target.value)} /></div>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save settings'}</button>
        </div>

        <div className="card">
          <h2>Email delivery (SMTP)</h2>
          <p className="muted small">
            Required for customer email verification codes. Example: Gmail : host <code>smtp.gmail.com</code>, port <code>587</code>, your email as user, an <b>App Password</b> as password.
          </p>
          <div className="form-row">
            <div className="field"><label>SMTP host</label><input value={settings.smtp_host || ''} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" /></div>
            <div className="field"><label>Port</label><input type="number" value={settings.smtp_port || ''} onChange={(e) => set('smtp_port', e.target.value)} placeholder="587" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>SMTP user (email)</label><input value={settings.smtp_user || ''} onChange={(e) => set('smtp_user', e.target.value)} autoComplete="off" /></div>
            <div className="field"><label>SMTP password / app password</label><input type="password" value={settings.smtp_pass || ''} onChange={(e) => set('smtp_pass', e.target.value)} autoComplete="new-password" placeholder="stored securely" /></div>
          </div>
          <div className="field"><label>From address (optional)</label><input value={settings.smtp_from || ''} onChange={(e) => set('smtp_from', e.target.value)} placeholder={`defaults to SMTP user`} /></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save settings'}</button>
            <button
              className="btn"
              disabled={testing}
              onClick={async () => {
                setTesting(true);
                try {
                  await api('/system/settings', { method: 'PUT', body: {
                    smtp_host: settings.smtp_host, smtp_port: settings.smtp_port, smtp_user: settings.smtp_user,
                    smtp_pass: settings.smtp_pass, smtp_from: settings.smtp_from,
                  } });
                  const r = await api('/system/test-email', { method: 'POST', body: { to: testTo || settings.shop_email } });
                  toast(r.message || 'Test email sent', 'info');
                } catch (err) { toast(err.message, 'error'); }
                finally { setTesting(false); }
              }}
            >{testing ? 'Sending…' : 'Send test email'}</button>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="send to (email)" style={{ flex: 1, minWidth: 180 }} />
          </div>
        </div>

        <div className="card">
          <h2>Backup & restore</h2>
          <p className="muted">Download a full copy of the SQLite database. Keep backups somewhere safe and schedule regular downloads.</p>
          <button className="btn primary" onClick={backup}>Download backup (.db)</button>
          <div className="sep" style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <p className="muted">Restore from a backup file. The current database is saved as <b>stationery-pre-restore.db</b> first.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="file" accept=".db" onChange={(e) => setFile(e.target.files[0])} />
            <button className="btn danger" onClick={restore}>Restore</button>
          </div>
        </div>
      </div>
    </div>
  );
}