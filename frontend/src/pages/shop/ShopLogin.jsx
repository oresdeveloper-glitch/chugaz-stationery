import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { shopApi } from '../../lib/api';
import { useShop } from '../../shop/ShopContext';
import { useToast } from '../../components/Toast';

export default function ShopLogin() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [unverified, setUnverified] = useState(null); // email awaiting verification
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const { login } = useShop();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const codeRef = useRef(null);

  useEffect(() => {
    if (unverified && codeRef.current) codeRef.current.focus();
  }, [unverified]);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { token, user } = await shopApi('/login', { method: 'POST', body: form });
      login(token, user);
      toast(`Welcome back, ${user.name}`);
      navigate(params.get('next') || '/shop');
    } catch (err) {
      if (err.code === 'EMAIL_UNVERIFIED' || /verify your email/i.test(err.message || '')) {
        setUnverified(form.email);
        toast('Verify your email to finish activating your account', 'error');
      } else {
        toast(err.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { token, user } = await shopApi('/verify-email', { method: 'POST', body: { email: unverified, code } });
      login(token, user);
      toast('Email verified : welcome!', 'info');
      navigate(params.get('next') || '/shop');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await shopApi('/resend-verification', { method: 'POST', body: { email: unverified } });
      toast('A new code has been sent', 'info');
      setSeconds(45);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (unverified) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <img src="/logo-auth.png?v=3" alt="CHUGAZ - Design Office Supplies" className="login-logo" />
          <h1>Verify your email</h1>
          <p className="muted small">
            We sent a 6-digit code to <b>{unverified}</b>.<br />Enter it to activate your account.
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
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
          </form>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
            {seconds > 0
              ? `You can request a new code in ${seconds}s`
              : <button type="button" className="btn sm" onClick={resend} disabled={busy}>Resend code</button>}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <img src="/logo-auth.png?v=3" alt="CHUGAZ - Design Office Supplies" className="login-logo" />
        <h1>Customer sign in</h1>
        <p className="muted small">Sign in to order from our CHUGAZ STATIONERY.</p>
        <form onSubmit={submit}>
          <div className="field"><label>Email</label><input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus /></div>
          <div className="field"><label>Password</label><input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
          New customer? <Link to="/shop/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
