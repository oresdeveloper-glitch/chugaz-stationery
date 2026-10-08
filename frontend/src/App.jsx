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

  // Global live-data poller: fetch a cheap version hash and announce a single
  // 'chugaz-live' event whenever it changes, so every open page refetches its
  // own data in place — no page reloads, no per-page intervals. Skipped while
  // the tab is hidden; caught up immediately when it becomes visible again.
  // On serverless the hash can bounce between instances (A→B→A): the first
  // change is announced immediately, but once a previously-seen version comes
  // back we suppress announcements until the version holds for 2 ticks, then
  // announce one resync — so a flap never turns into an event storm.
  useEffect(() => {
    let last = null;
    let seen = [];
    let suppressed = false;
    let hold = 0;
    let ticks = 0;
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
        ticks += 1;
        // Every 4th tick, ask a random instance how its DATA version differs
        // from our pinned one (data_version ignores per-instance audit noise);
        // a mismatch means the two disks drifted apart, and (admin sessions)
        // the backup/merge cycle brings them back to the same data so the
        // dashboard can never flip between two numbers again.
        if (ticks % 4 === 0) {
          try {
            const u = getUser();
            const p = await api('/sync', { anyInstance: true });
            const pin = getDbPin();
            if (u && u.role === 'admin' && p && p.db_marker && p.data_version && pin && p.db_marker !== pin && p.data_version !== s.data_version) {
              convergeInstances().catch(() => {});
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
    const id = setInterval(tick, 4000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
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