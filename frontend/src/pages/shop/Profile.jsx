import { useEffect, useState } from 'react';
import { shopApi, setShopAuth, getShopUser } from '../../lib/api';
import RequireShopAuth from '../../shop/RequireShopAuth';
import { useToast } from '../../components/Toast';

function ProfileInner() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    shopApi('/me').then(({ user }) => setForm({ name: user.name, phone: user.phone || '', email: user.email, avatar: user.avatar, avatar_url: user.avatar_url || user.avatar, password: '' })).catch((e) => toast(e.message, 'error'));
  }, []);

  const onAvatar = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toast('Image too large — max 3MB', 'error');
    const fd = new FormData();
    fd.append('avatar', file);
    setUploading(true);
    try {
      const res = await shopApi('/me/avatar', { method: 'POST', body: fd });
      setForm({ ...form, avatar: res.avatar, avatar_url: res.avatar_url });
      toast('Profile picture updated');
    } catch (err) { toast(err.message, 'error'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const save = async (e) => {
    e.preventDefault();
    if (form.password && !form.currentPassword) return toast('Enter your current password to change it', 'error');
    setSaving(true);
    try {
      const body = { name: form.name, phone: form.phone };
      if (form.password) {
        body.password = form.password;
        body.current_password = form.currentPassword;
      }
      const res = await shopApi('/me', { method: 'PUT', body });
      if (res?.token) setShopAuth(res.token, getShopUser());
      toast('Profile updated');
      setForm({ ...form, password: '', currentPassword: '' });
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  if (!form) return <div className="card">Loading...</div>;
  const initials = (form.name || '?').trim().split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase();

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-header" style={{borderBottom:'none', paddingBottom:0, marginBottom:14}}>
        <div>
          <h1 style={{marginBottom:4}}>My profile</h1>
          <p className="muted small" style={{margin:0}}>Manage your photo, personal details and password.</p>
        </div>
      </div>

      <div className="card" style={{display:'flex', alignItems:'center', gap:16, padding:'16px 18px', marginBottom:14}}>
        <label style={{position:'relative', cursor:'pointer', flexShrink:0}} title="Change profile picture">
          {form.avatar_url ? (
            <img src={form.avatar_url} alt="" style={{width:64, height:64, borderRadius:'50%', objectFit:'cover', border:'2px solid var(--border)', display:'block'}} />
          ) : (
            <div style={{width:64, height:64, borderRadius:'50%', background:'var(--primary)', color:'#fff', display:'grid', placeItems:'center', fontWeight:700, fontSize:18}}>{initials}</div>
          )}
          <span style={{position:'absolute', right:-2, bottom:-2, width:22, height:22, borderRadius:'50%', background:'var(--primary)', color:'#fff', display:'grid', placeItems:'center', fontSize:12, border:'2px solid #fff'}}>+</span>
          <input type="file" accept="image/*" onChange={onAvatar} style={{display:'none'}} />
        </label>
        <div style={{minWidth:0, flex:1}}>
          <div style={{fontWeight:700, fontSize:15, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{form.name}</div>
          <div className="muted small" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{form.email}</div>
          {form.phone && <div className="muted small">{form.phone}</div>}
          <label className="muted small" style={{color:'var(--primary)', cursor:'pointer', fontWeight:600}}>{uploading ? 'Uploading...' : 'Change photo'}<input type="file" accept="image/*" onChange={onAvatar} style={{display:'none'}} /></label>
        </div>
        <span className="badge amber" style={{flexShrink:0}}>Customer</span>
      </div>

      <div className="card">
        <h3 style={{margin:'0 0 14px', fontSize:14, fontWeight:600}}>Personal details</h3>
        <form onSubmit={save}>
          <div className="form-row">
            <div className="field"><label>Full name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" /></div>
            <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="07XXXXXXXX" autoComplete="tel" /></div>
          </div>
          <div className="field"><label>Email — cannot change</label><input value={form.email} disabled style={{background:'var(--panel-2)'}} /></div>
          <div style={{height:1, background:'var(--border)', margin:'16px 0'}} />
          <h3 style={{margin:'0 0 12px', fontSize:14, fontWeight:600}}>Change password</h3>
          <div className="field"><label>New password (leave blank to keep)</label><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" /></div>
          {form.password && (
            <div className="field"><label>Current password — required to confirm</label><input type="password" autoComplete="current-password" value={form.currentPassword || ''} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required /></div>
          )}
          <p className="small muted" style={{ marginTop: -2, marginBottom:12 }}>Use 8+ characters with letters and numbers.</p>
          <div style={{display:'flex', justifyContent:'flex-end'}}>
            <button className="btn primary" style={{minWidth:140, justifyContent:'center'}} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Profile() {
  return <RequireShopAuth><ProfileInner /></RequireShopAuth>;
}