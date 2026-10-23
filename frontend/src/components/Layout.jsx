import { useState, useEffect } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { clearAuth, api, setAuth, getToken, getUser, lockPrintRedirect, unlockPrintRedirect, refreshToken } from '../lib/api';
import { canRole } from '../lib/roles';
import { dbKeepInit } from '../lib/dbkeep';
import Modal from './Modal';
import { useToast } from './Toast';
import SaleBell from './SaleBell';
import I from './icons';

export default function Layout({ user, setUser, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [userMenu, setUserMenu] = useState(false);
  const [pwdModal, setPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [signOutAllBusy, setSignOutAllBusy] = useState(false);
  const close = () => setOpen(false);

  // Re-run the persistence check right after login (App's own mount ran while
  // the user was still signed out, so no admin backup had been scheduled yet).
  useEffect(() => {
    dbKeepInit();
  }, []);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (e.target.closest && !e.target.closest('.staff-user-wrap')) setUserMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    setUserMenu(false);
  }, [location.pathname]);

  // Esc closes dropdowns/modals
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setUserMenu(false);
        setPwdModal(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onBeforePrint = async () => {
      lockPrintRedirect();
      try {
        const token = getToken();
        if (token) {
          const nt = await refreshToken(token);
          if (nt) setAuth(nt, getUser());
        }
      } catch { /* proceed with print even if refresh fails */ }
    };
    const onAfterPrint = () => {
      unlockPrintRedirect();
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  const links = [
    { to: '/', label: 'Dashboard', icon: 'dashboard', min: 'clerk' },
    { to: '/pos', label: 'Point of Sale', icon: 'bolt', min: 'cashier' },
    { to: '/scan', label: 'Barcode Scanner', icon: 'scan', min: 'cashier' },
    { to: '/orders', label: 'Customer Orders', icon: 'bag', min: 'clerk' },
    { to: '/products', label: 'Products', icon: 'box', min: 'clerk' },
    { to: '/inventory', label: 'Inventory', icon: 'list', min: 'admin' },
    { to: '/sales', label: 'Sales', icon: 'receipt', min: 'cashier' },
    { to: '/purchases', label: 'Purchases', icon: 'inbox', min: 'admin' },
    { to: '/suppliers', label: 'Suppliers', icon: 'truck', min: 'manager' },
    { to: '/customers', label: 'Customers', icon: 'users', min: 'clerk' },
    { to: '/expenses', label: 'Expenses', icon: 'doc', min: 'manager' },
    { to: '/reports', label: 'Reports', icon: 'chart', min: 'manager' },
    { to: '/users', label: 'Users', icon: 'user', min: 'manager' },
    { to: '/messages', label: 'Messages', icon: 'mail', min: 'manager' },
    { to: '/settings', label: 'Settings', icon: 'gear', min: 'admin' },
    { to: '/shop', label: 'CHUGAZ STATIONERY', icon: 'cart' },
  ].filter((l) => canRole(user, l.min));

  // Match current path to a nav link so the top bar shows the active page title.
  const active = links.find((l) => l.to === '/' ? location.pathname === '/' : (location.pathname === l.to || location.pathname.startsWith(l.to + '/'))) || { label: '', icon: '' };

  const logout = () => {
    clearAuth();
    setUser(null);
    navigate('/login');
  };

  // Revokes every other session server-side (token_ver bump); this device
  // continues on the replacement token the endpoint hands back.
  const logoutEverywhere = async () => {
    setUserMenu(false);
    setSignOutAllBusy(true);
    try {
      const res = await api('/auth/logout-all', { method: 'POST' });
      if (res?.token) setAuth(res.token, getUser());
      toast('Signed out on every other device', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSignOutAllBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwdForm.next !== pwdForm.confirm) return toast('New passwords do not match', 'error');
    setPwdBusy(true);
    try {
      const res = await api('/auth/password', { method: 'PUT', body: { current: pwdForm.current, next: pwdForm.next } });
      if (res?.token) setAuth(res.token, getUser());
      toast('Password changed. Other sessions were signed out.', 'info');
      setPwdModal(false);
      setPwdForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast(err.message || 'Failed to change password', 'error');
    } finally {
      setPwdBusy(false);
    }
  };

  const timeStr = clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = clock.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const breadcrumb = location.pathname === '/' ? 'Dashboard' : `${active.label || 'Home'}`;
  const avatar = (user?.name || '?').trim().charAt(0).toUpperCase();
  const roleLabel = user?.role === 'cashier' ? 'Cashier' : user?.role === 'admin' ? 'Administrator' : user?.role === 'manager' ? 'Manager' : (user?.role || '');
  const officeLabel = user?.office ? ` · ${user.office}` : '';

  return (
    <div className="app">
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={close} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><img src="/logo.png" alt="" className="brand-logo" /></div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')} end={l.to === '/'} onClick={close}>
              <span className="ico"><I name={l.icon} size={17} /></span>
              <span className="txt">{l.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="staff-col">
        <header className="staff-header">
                    <div className="staff-topbar">
            <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><I name="menu" size={20} /></button>
            <div className="staff-brand">
              <img src="/logo.png" alt="" className="staff-brand-logo" />
              <span className="staff-brand-titles">
                <span className="staff-brand-sub">{roleLabel}{officeLabel}</span>
              </span>
            </div>
            <div className="staff-top-right">
            {canRole(user, 'manager') && <SaleBell />}
            <div className="staff-session">
              <span className="staff-session-role">{roleLabel}</span>
              {user?.office && <span className="staff-session-office">{user.office}</span>}
            </div>
            <div className="staff-clock" title="Current time">
              <span className="staff-clock-time">{timeStr}</span>
              <span className="staff-clock-date">{dateStr}</span>
            </div>
            <div className="staff-user-wrap">
              <button className="staff-user-chip" onClick={() => setUserMenu((v) => !v)} aria-label="Account menu">
                <span className="staff-avatar">{avatar}</span>
                <span className="staff-user-meta">
                  <span className="staff-user-name">{user?.name}</span>
                  <span className="staff-role-badge">{user?.role}{officeLabel}</span>
                </span>
                <span className="staff-chev"><I name="chevDown" size={14} /></span>
              </button>
              {userMenu && (
                <div className="staff-user-menu">
                  <div className="staff-user-head">
                    <span className="staff-avatar lg">{avatar}</span>
                    <span className="staff-user-head-meta">
                      <span className="h-name">{user?.name}</span>
                      <span className="h-email">{user?.email}</span>
                    </span>
                  </div>
                  <button className="staff-user-item" onClick={() => { setUserMenu(false); setPwdModal(true); }}>
                    <span className="u-ico"><I name="lock" size={14} /></span> Change password
                  </button>
                  <button className="staff-user-item" disabled={signOutAllBusy} onClick={logoutEverywhere}>
                    <span className="u-ico"><I name="power" size={14} /></span> {signOutAllBusy ? 'Signing out…' : 'Sign out everywhere'}
                  </button>
                  <div className="staff-user-sep" />
                  <button className="staff-user-item danger" onClick={() => { setUserMenu(false); logout(); }}>
                    <span className="u-ico"><I name="power" size={14} /></span> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
</header>
        
        <main className="main">{children}</main>
      </div>

      {pwdModal && (
        <Modal open={pwdModal} title="Change password" onClose={() => setPwdModal(false)}>
          <form onSubmit={changePassword} className="form">
            <div className="field">
              <label>Current password</label>
              <input type="password" required value={pwdForm.current} onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })} />
            </div>
            <div className="field">
              <label>New password</label>
              <input type="password" autoComplete="new-password" required minLength={10} value={pwdForm.next} onChange={(e) => setPwdForm({ ...pwdForm, next: e.target.value })} />
              <p className="small muted" style={{ marginTop: 4 }}>10+ characters with a capital letter or symbol, plus letters and numbers. Other signed-in sessions will be signed out.</p>
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input type="password" autoComplete="new-password" required minLength={10} value={pwdForm.confirm} onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })} />
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setPwdModal(false)}>Cancel</button>
              <button type="submit" className="btn primary" disabled={pwdBusy}>{pwdBusy ? 'Saving…' : 'Update password'}</button>
            </div>
          </form>
        </Modal>
      )}
      <nav className="staff-bottom-nav" aria-label="Mobile navigation">
        <div className="staff-bottom-nav-inner">
          <NavLink to="/" end className={({isActive})=> isActive?'active':''}><span className="ico"><I name="dashboard" size={18}/></span><span>Home</span></NavLink>
          <NavLink to="/pos" className={({isActive})=> isActive?'active':''}><span className="ico"><I name="bolt" size={18}/></span><span>POS</span></NavLink>
          <NavLink to="/orders" className={({isActive})=> isActive?'active':''}><span className="ico"><I name="bag" size={18}/></span><span>Orders</span></NavLink>
          <NavLink to="/products" className={({isActive})=> isActive?'active':''}><span className="ico"><I name="box" size={18}/></span><span>Products</span></NavLink>
          <button onClick={()=> setOpen(true)}><span className="ico"><I name="menu" size={18}/></span><span>More</span></button>
        </div>
      </nav>
    </div>
  );
}