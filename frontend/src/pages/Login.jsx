import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setAuth } from '../lib/api';
import { useToast } from '../components/Toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email, password } });
      setAuth(data.token, data.user);
      toast('Welcome back, ' + data.user.name);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img src="/logo-auth.png?v=3" alt="CHUGAZ - Design Office Supplies" className="login-logo" />
        <div className="subtitle">CHUGAZ STATIONERY · Stock, Sales & Orders</div>
        {error && <div className="badge red" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" autoFocus required />
        </div>
        <div className="field">
          <label>Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
        </div>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <div className="login-hint">
          Staff sign-in only. Customers: use the CHUGAZ STATIONERY below.
        </div>
        <a className="login-hint" href="/shop" style={{ display: 'block', marginTop: 8, color: 'var(--accent)' }}>
          Customer? Sign in at the CHUGAZ STATIONERY →
        </a>
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 11, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.08em' }}>
          STATIONERY POS · VERSION 3.0
        </div>
      </form>
    </div>
  );
}