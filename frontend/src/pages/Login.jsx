import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, shopApi, setAuth, setShopAuth } from '../lib/api';
import { useToast } from '../components/Toast';

const PASSWORD_RULE = 'Password must be at least 8 characters and contain both letters and numbers';

export default function Login() {
  const [mode, setMode] = useState(() => (new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login'));
  const [form, setForm] = useState({ email: '', password: '' });
  const [reg, setReg] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [unverified, setUnverified] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
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
      const { token, user } = await api('/auth/login', { method: 'POST', body: form });
      if (user.role === 'customer') {
        setShopAuth(token, user);
        toast(`Welcome back, ${user.name}`);
        navigate(params.get('next') || '/shop');
      } else {
        setAuth(token, user);
        toast(`Welcome back, ${user.name}`);
        navigate(params.get('next') || '/');
      }
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

  const register = async (e) => {
    e.preventDefault();
    if (reg.password !== reg.confirm) return toast('Passwords do not match', 'error');
    if (reg.password.length < 8 || !/[A-Za-z]/.test(reg.password) || !/[0-9]/.test(reg.password)) {
      return toast(PASSWORD_RULE, 'error');
    }
    setBusy(true);
    try {
      const res = await shopApi('/register', { method: 'POST', body: { name: reg.name, email: reg.email, phone: reg.phone, password: reg.password } });
      if (res.needs_verification) {
        setUnverified(res.email);
        setSeconds(45);
        toast(res.message || 'Verification code sent — check your email', 'info');
      } else {
        if (res.token) {
          setShopAuth(res.token, res.user);
        }
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
      const { token, user } = await shopApi('/verify-email', { method: 'POST', body: { email: unverified, code } });
      setShopAuth(token, user);
      toast('Email verified : welcome!', 'info');
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
          <img src="/logo.png" alt="CHUGAZ" className="login-logo" />
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
        <img src="/logo.png" alt="CHUGAZ" className="login-logo" />
        <div className="auth-tabs">
          <button className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Sign in</button>
          <button className={`auth-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>Create account</button>
        </div>

        {mode === 'login' ? (
          <>
            <h1>Sign in</h1>
            <p className="muted small">Staff and customer sign in</p>
            <form onSubmit={submit}>
              <div className="field"><label>Email</label><input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus /></div>
              <div className="field"><label>Password</label><input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
            <p className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
              New customer? <button type="button" className="link" onClick={() => setMode('register')}>Create an account</button>
            </p>
          </>
        ) : (
          <>
            <h1>Create customer account</h1>
            <p className="muted small">Start ordering from our store today.</p>
            <form onSubmit={register}>
              <div className="field"><label>Full name</label><input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} required autoFocus /></div>
              <div className="field"><label>Email (must be real : we verify it)</label><input type="email" autoComplete="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} required /></div>
              <div className="field"><label>Phone</label><input value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} autoComplete="tel" /></div>
              <div className="form-row">
                <div className="field"><label>Password</label><input type="password" autoComplete="new-password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} required minLength={8} /></div>
                <div className="field"><label>Confirm</label><input type="password" autoComplete="new-password" value={reg.confirm} onChange={(e) => setReg({ ...reg, confirm: e.target.value })} required /></div>
              </div>
              <p className="muted small" style={{ marginTop: -6 }}>8+ characters with letters and numbers.</p>
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
            </form>
            <p className="muted small" style={{ textAlign: 'center', marginTop: 12 }}>
              Already have an account? <button type="button" className="link" onClick={() => setMode('login')}>Sign in</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
