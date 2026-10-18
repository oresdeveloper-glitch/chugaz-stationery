import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getUser, clearAuth, isSessionValid, api, getDbPin } from './lib/api';
import { dbKeepInit, convergeInstances } from './lib/dbkeep';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Inventory from './pages/Inventory.jsx';
import Pos from './pages/Pos.jsx';
import Sales from './pages/Sales.jsx';
import Suppliers from './pages/Suppliers.jsx';
import Purchases from './pages/Purchases.jsx';
import Customers from './pages/Customers.jsx';
import Expenses from './pages/Expenses.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import StaffOrders from './pages/StaffOrders.jsx';
import ScanScreen from './pages/ScanScreen.jsx';
import Messages from './pages/Messages.jsx';
import Forbidden from './pages/Forbidden.jsx';
import RequireRole from './components/RequireRole.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ShopProvider } from './shop/ShopContext.jsx';
import ShopLayout from './shop/ShopLayout.jsx';
import Catalog from './pages/shop/Catalog.jsx';
import ProductDetail from './pages/shop/ProductDetail.jsx';
import Cart from './pages/shop/Cart.jsx';
import Checkout from './pages/shop/Checkout.jsx';
import MyOrders from './pages/shop/MyOrders.jsx';
import OrderDetail from './pages/shop/OrderDetail.jsx';
import Invoice from './pages/shop/Invoice.jsx';
import Profile from './pages/shop/Profile.jsx';
import Addresses from './pages/shop/Addresses.jsx';
import Contact from './pages/shop/Contact.jsx';
import Splash from './pages/shop/Splash.jsx';

function RequireAuth({ children }) {
  const [user, setUser] = useState(() => {
    if (!isSessionValid()) { clearAuth(); return null; }
    return getUser();
  });
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'customer') return <Navigate to="/shop" replace />;
  return <Layout user={user} setUser={setUser}>{children}</Layout>;
}

const g = (min, node) => <RequireRole min={min}>{node}</RequireRole>;

export default function App() {
  useEffect(() => {
    dbKeepInit();
    const onFocus = () => dbKeepInit();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Push channel: the server sends an SSE event the moment the data-version
  // hash changes, so every open page updates the instant new data is
  // generated - nothing in this app polls on a timer. The event is only a
  // hint; it fires the same chugaz-nudge the write path uses, and the pinned
  // /sync tick below remains the single source of truth. EventSource cannot
  // send headers, so the pinned instance rides along as ?marker= and the
  // server answers 409 on mismatch; the browser retries the stream until it
  // lands on our instance, and a pin change reopens it via chugaz-pin.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    let es = null;
    let down = null;
    const announce = (open) => {
      try { window.dispatchEvent(new CustomEvent('chugaz-sse', { detail: { open } })); } catch (e) { /* ignore */ }
    };
    // Grace period before flipping the indicator to "reconnecting" so the brief
    // reconnects of a healthy stream don't flicker the dashboard badge.
    const markUp = () => { if (down) { clearTimeout(down); down = null; } announce(true); };
    const markDown = () => { if (down) clearTimeout(down); down = setTimeout(() => announce(false), 10000); };
    const nudge = () => { try { window.dispatchEvent(new Event('chugaz-nudge')); } catch (e) { /* ignore */ } };
    const open = () => {
      if (es) { try { es.close(); } catch (e) { /* ignore */ } es = null; }
      try {
        const pin = getDbPin();
        es = new EventSource(pin ? `/api/events?marker=${encodeURIComponent(pin)}` : '/api/events');
        es.onopen = markUp;
        es.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data);
            // hello = (re)connect catch-up: anything generated while the
            // stream was down is picked up by the /sync version comparison.
            if (d && (d.type === 'change' || d.type === 'hello')) nudge();
          } catch (err) { /* ignore malformed frame */ }
        };
        es.onerror = markDown;
      } catch (e) { es = null; }
    };
    open();
    // Re-pin (convergence or affinity recovery): reopen so the stream keeps
    // following the instance our reads are pinned to.
    const onPin = () => open();
    window.addEventListener('chugaz-pin', onPin);
    return () => {
      if (down) clearTimeout(down);
      window.removeEventListener('chugaz-pin', onPin);
      if (es) es.close();
      announce(false);
    };
  }, []);

  // After a write, force a couple of extra version checks so a lagging
  // instance can't leave stale totals on the dashboard.
  useEffect(() => {
    let n = 0;
    const onMut = () => {
      const me = ++n;
      [600, 1800].forEach((ms) => setTimeout(() => { if (me === n) window.dispatchEvent(new Event('chugaz-nudge')); }, ms));
    };
    window.addEventListener('chugaz-mutated', onMut);
    return () => window.removeEventListener('chugaz-mutated', onMut);
  }, []);

  // Check a cheap version hash on demand - when the push channel signals a
  // change, after a local write, or when the tab regains focus - and announce
  // 'chugaz-live' so every open page refetches. No interval runs anywhere.
  // Flap suppression: a previously-seen version must hold 2 checks before a
  // resync fires, so instance bouncing never storms events.
  useEffect(() => {
    let last = null;
    let seen = [];
    let suppressed = false;
    let hold = 0;
    let lastConv = 0;
    let stopped = false;
    const announce = (v) => {
      try { window.dispatchEvent(new CustomEvent('chugaz-live', { detail: { kinds: ['sync'], version: v } })); } catch (e) { /* ignore */ }
    };
    const tick = async () => {
      if (stopped || document.hidden) return;
      try {
        const s = await api('/sync');
        const v = s && s.version;
        if (v == null) return;
        // At most once a minute (event-triggered, never on a timer), check
        // for a richer instance and re-merge if found.
        if (Date.now() - lastConv >= 60000) {
          lastConv = Date.now();
          try {
            const u = getUser();
            const pin = getDbPin();
            // Converge whenever any live instance holds more sales than our pinned one.
            if (u && (u.role === 'admin' || u.role === 'manager') && pin) {
              const mine = Number(s.sales) || 0;
              let richer = false;
              for (let i = 0; i < 6 && !richer; i++) {
                const p = await api('/sync', { anyInstance: true });
                if (p && p.db_marker !== pin && (Number(p.sales) || 0) > mine) richer = true;
              }
              if (richer) convergeInstances().catch(() => {});
            }
          } catch (e) { /* ignore */ }
        }
        if (last === null) {
          last = v;
          seen = [v];
          return;
        }
        if (v === last) {
          if (suppressed) {
            hold += 1;
            if (hold >= 2) {
              suppressed = false;
              hold = 0;
              announce(v);
            }
          }
          return;
        }
        const bounced = seen.includes(v);
        last = v;
        seen.push(v);
        if (seen.length > 4) seen.shift();
        if (!suppressed && !bounced) {
          announce(v);
        } else {
          suppressed = true;
          hold = 1;
        }
      } catch (e) { /* ignore */ }
    };
    tick();
    const onVis = () => { if (!document.hidden) tick(); };
    const onNudge = () => tick();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    window.addEventListener('chugaz-nudge', onNudge);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.removeEventListener('chugaz-nudge', onNudge);
    };
  }, []);
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forbidden" element={<RequireAuth><Forbidden /></RequireAuth>} />
        <Route path="/" element={<RequireAuth>{g('clerk', <Dashboard />)}</RequireAuth>} />
        <Route path="/products" element={<RequireAuth>{g('clerk', <Products />)}</RequireAuth>} />
        <Route path="/inventory" element={<RequireAuth>{g('admin', <Inventory />)}</RequireAuth>} />
        <Route path="/pos" element={<RequireAuth>{g('cashier', <Pos />)}</RequireAuth>} />
        <Route path="/scan" element={<RequireAuth>{g('cashier', <ScanScreen />)}</RequireAuth>} />
        <Route path="/sales" element={<RequireAuth>{g('cashier', <Sales />)}</RequireAuth>} />
        <Route path="/suppliers" element={<RequireAuth>{g('manager', <Suppliers />)}</RequireAuth>} />
        <Route path="/purchases" element={<RequireAuth>{g('admin', <Purchases />)}</RequireAuth>} />
        <Route path="/customers" element={<RequireAuth>{g('clerk', <Customers />)}</RequireAuth>} />
        <Route path="/orders" element={<RequireAuth>{g('clerk', <StaffOrders />)}</RequireAuth>} />
        <Route path="/expenses" element={<RequireAuth>{g('manager', <Expenses />)}</RequireAuth>} />
        <Route path="/reports" element={<RequireAuth>{g('manager', <Reports />)}</RequireAuth>} />
        <Route path="/users" element={<RequireAuth>{g('manager', <Users />)}</RequireAuth>} />
        <Route path="/messages" element={<RequireAuth>{g('manager', <Messages />)}</RequireAuth>} />
        <Route path="/settings" element={<RequireAuth>{g('admin', <Settings />)}</RequireAuth>} />
        <Route
          path="/shop"
          element={
            <ShopProvider>
              <ShopLayout />
            </ShopProvider>
          }
        >
          <Route index element={<Catalog />} />
          <Route path="product/:id" element={<ProductDetail />} />
          <Route path="cart" element={<Cart />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="orders" element={<MyOrders />} />
          <Route path="order/:id" element={<OrderDetail />} />
          <Route path="orders/:id/invoice" element={<Invoice />} />
          <Route path="profile" element={<Profile />} />
          <Route path="addresses" element={<Addresses />} />
          <Route path="contact" element={<Contact />} />
          <Route path="welcome" element={<Splash />} />
          <Route path="login" element={<Navigate to="/login" replace />} />
          <Route path="register" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/shop" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}