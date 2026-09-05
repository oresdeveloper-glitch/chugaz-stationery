import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { shopApi } from '../../lib/api';
import { useShop } from '../../shop/ShopContext';
import { useToast } from '../../components/Toast';

export default function ShopRegister() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [pending, setPending] = useState(null); // { email }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const { login } = useShop();
  const toast = useToast();
  const navigate = useNavigate();
  const codeRef = useRef(null);

  useEffect(() => {
    if (pending && codeRef.current) codeRef.current.focus();
  }, [pending]);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast('Passwords do not match', 'error');
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      return toast('Password: at least 8 characters with letters and numbers', 'error');
    }
    setBusy(true);
    try {
      const res = await shopApi('/register', { method: 'POST', body: { name: form.name, email: form.email, phone: form.phone, password: form.password } });
      if (res.needs_verification) {
        setPending({ email: res.email });
        setSeconds(45);
        toast(res.message || 'Verification code sent : check your email', 'info');
      } else {
        if (res.token) login(res.token, res.user);
        toast(res.notice || 'Account created : welcome!');
        navigate('/shop');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { token, user } = await shopApi('/verify-email', { method: 'POST', body: { email: pending.email, code } });
      login(token, user);
      toast('Email verified : your account is active!', 'info');
      navigate('/shop');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await shopApi('/resend-verification', { method: 'POST', body: { email: pending.email } });
      toast('A new code has been sent', 'info');
      setSeconds(45);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <img src="/logo-auth.png?v=3" alt="CHUGAZ - Design Office Supplies" className="login-logo" />
          <h1>Check your email</h1>
          <p className="muted small">
            We sent a 6-digit code to <b>{pending.email}</b>.<br />Enter it below to activate your account.
          </p>
          <form onSubmit={confirm}>
            <div className="field">
              <label>Verification code</label>
              <input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                pattern="\d{6}"
                placeholder="••••••"
                style={{ textAlign: 'center', fontSize: 24, letterSpacing: 12, fontWeight: 800 }}
                required
              />
            </div>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify & activate'}
            </button>
          </form>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
            {seconds > 0
              ? `You can request a new code in ${seconds}s`
              : <button type="button" className="btn sm" onClick={resend} disabled={busy}>Resend code</button>}
            <br /><br />
            Wrong email? <Link to="/shop/register">Start over</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <img src="/logo-auth.png?v=3" alt="CHUGAZ - Design Office Supplies" className="login-logo" />
        <h1>Create customer account</h1>
        <p className="muted small">Start ordering from our store today.</p>
        <form onSubmit={submit}>
          <div className="field"><label>Full name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
          <div className="field"><label>Email (must be real : we verify it)</label><input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></div>
          <div className="form-row">
            <div className="field"><label>Password</label><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
            <div className="field"><label>Confirm</label><input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required /></div>
          </div>
          <p className="muted small" style={{ marginTop: -6 }}>8+ characters with letters and numbers.</p>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
          Already have an account? <Link to="/shop/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
