import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import { getUser, clearAuth, isSessionValid, api, getDbPin, lastSyncVersion } from './lib/api';
import { dbKeepInit, convergeInstances, knownCounts, canKeep } from './lib/dbkeep';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Forbidden from './pages/Forbidden.jsx';
import RequireRole from './components/RequireRole.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ShopProvider } from './shop/ShopContext.jsx';

// Route chunks: shell + login paint first, each page downloads only when first
// opened. This also pulls @zxing (the barcode scanner, only used by ScanScreen)
// out of the initial bundle, which was the single biggest chunk.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const Inventory = lazy(() => import('./pages/Inventory.jsx'));
const Pos = lazy(() => import('./pages/Pos.jsx'));
const Sales = lazy(() => import('./pages/Sales.jsx'));
const Suppliers = lazy(() => import('./pages/Suppliers.jsx'));
const Purchases = lazy(() => import('./pages/Purchases.jsx'));
const Customers = lazy(() => import('./pages/Customers.jsx'));
const Expenses = lazy(() => import('./pages/Expenses.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const StaffOrders = lazy(() => import('./pages/StaffOrders.jsx'));
const ScanScreen = lazy(() => import('./pages/ScanScreen.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const ShopLayout = lazy(() => import('./shop/ShopLayout.jsx'));
const Catalog = lazy(() => import('./pages/shop/Catalog.jsx'));
const ProductDetail = lazy(() => import('./pages/shop/ProductDetail.jsx'));
const Cart = lazy(() => import('./pages/shop/Cart.jsx'));
const Checkout = lazy(() => import('./pages/shop/Checkout.jsx'));
const MyOrders = lazy(() => import('./pages/shop/MyOrders.jsx'));
const OrderDetail = lazy(() => import('./pages/shop/OrderDetail.jsx'));
const Invoice = lazy(() => import('./pages/shop/Invoice.jsx'));
const Profile = lazy(() => import('./pages/shop/Profile.jsx'));
const Addresses = lazy(() => import('./pages/shop/Addresses.jsx'));
const Contact = lazy(() => import('./pages/shop/Contact.jsx'));
const Splash = lazy(() => import('./pages/shop/Splash.jsx'));

// Suspense fallback while a route chunk loads (one small spinner, no layout jump).
function RouteLoading() {
  return (
    <div className="route-loading" role="status">
      <span className="route-loading-dot" />
      Loading…
    </div>
  );
}

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
    let errs = 0;
    const open = () => {
      if (es) { try { es.close(); } catch (e) { /* ignore */ } es = null; }
      try {
        const pin = getDbPin();
        es = new EventSource(pin ? `/api/events?marker=${encodeURIComponent(pin)}` : '/api/events');
        es.onopen = () => { errs = 0; markUp(); };
        es.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data);
            if (!d || (d.type !== 'change' && d.type !== 'hello')) return;
            // The hello frame is a reconnect catch-up, and the app already ran
            // its mount/focus version check. Nudging on an unchanged version
            // made every stream reconnect fan out into a fresh dashboard +
            // notifications + sync round trip for nothing.
            if (d.version != null && String(d.version) === lastSyncVersion()) return;
            nudge();
          } catch (err) { /* ignore malformed frame */ }
        };
        es.onerror = () => {
          markDown();
          // A recycled instance answers every reconnect with 409, so no onopen
          // ever arrives: after 3 failed opens run one /sync check - its
          // affinity fast-recovery re-pins the session, which fires chugaz-pin
          // (stream reopen + backup restore). An idle tab heals itself, no timer.
          errs += 1;
          if (errs >= 3) { errs = 0; nudge(); }
        };
      } catch (e) { es = null; }
    };
    open();
    // The pin changed (instance recycled, affinity recovery, convergence):
    // reopen the stream on the new instance AND run the backup-merge check
    // immediately, so a wiped disk gets its data back without waiting for a
    // tab focus. Debounced because recovery can re-pin twice in a row.
    let keepTimer = null;
    const onPin = () => {
      open();
      clearTimeout(keepTimer);
      keepTimer = setTimeout(() => { try { dbKeepInit(); } catch (e) { /* ignore */ } }, 400);
    };
    window.addEventListener('chugaz-pin', onPin);
    return () => {
      if (down) clearTimeout(down);
      if (keepTimer) clearTimeout(keepTimer);
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
  // Flap suppression: versions are tracked PER INSTANCE, so a page that is
  // bounced between the fleet's twins does not treat each switch as new data.
  useEffect(() => {
    let last = null;
    // Last version announced per db_marker (one entry per instance we hear
    // from, capped below).
    const seenByMarker = new Map();
    // Persisted across reloads: the fleet sweep is a discovery cost (several
    // probes + possibly a whole-database merge), so it must not restart from
    // zero on every page load.
    let lastConv = Number(localStorage.getItem('sst_converge_at') || 0) || 0;
    let stopped = false;
    let busy = false;
    let nudgeTimer = null;
    const announce = (v) => {
      try { window.dispatchEvent(new CustomEvent('chugaz-live', { detail: { kinds: ['sync'], version: v } })); } catch (e) { /* ignore */ }
    };
    const tick = async () => {
      if (stopped || document.hidden || busy) return;
      busy = true;
      try {
        let s = await api('/sync');
        // Wipe signature: live transaction counts fell below what this browser
        // has ever seen (ephemeral-disk reset, or affinity parked us on an
        // empty twin). Restore FIRST and re-read, so no page ever announces -
        // and fetches - the freshly-wiped 0 totals.
        const known = knownCounts();
        const curSales = s ? Number(s.sales) || 0 : 0;
        const curOrders = s ? Number(s.orders) || 0 : 0;
        if (s && ((known.sales > 0 && curSales < known.sales) || (known.orders > 0 && curOrders < known.orders))) {
          try { await dbKeepInit(); } catch (e) { /* ignore */ }
          try { const s2 = await api('/sync'); if (s2 && s2.version != null) s = s2; } catch (e) { /* ignore */ }
        }
        const v = s && s.version;
        if (v == null) return;
        // At most once a minute (event-triggered, never on a timer), check
        // for a richer instance and re-merge if found.
        if (Date.now() - lastConv >= 60000) {
          lastConv = Date.now();
          try { localStorage.setItem('sst_converge_at', String(lastConv)); } catch (e) { /* ignore */ }
          try {
            const pin = getDbPin();
            // Converge whenever any live instance holds more sales than our pinned one.
            if (canKeep() && pin) {
              const mine = Number(s.sales) || 0;
              let richer = false;
              for (let i = 0; i < 3 && !richer; i++) {
                const p = await api('/sync', { anyInstance: true });
                if (p && p.db_marker !== pin && (Number(p.sales) || 0) > mine) richer = true;
              }
              if (richer) convergeInstances().catch(() => {});
            }
          } catch (e) { /* ignore */ }
        }
        // Only a version change reported by the SAME instance is new data.
        // Production runs several instances on independent disks, so a page
        // bounced between them sees a different version every single time.
        // Announcing each of those refetched the dashboard in a loop (measured:
        // a fetch every ~600ms, forever). Remember the last version per marker
        // and ignore repeats from an instance we have already heard from.
        const marker = (s && s.db_marker) || '';
        const prevVersion = seenByMarker.get(marker);
        if (prevVersion === v) return;
        seenByMarker.set(marker, v);
        if (seenByMarker.size > 8) seenByMarker.delete(seenByMarker.keys().next().value);
        if (last === null) { last = v; return; }
        last = v;
        announce(v);
      } catch (e) { /* ignore */ } finally { busy = false; }
    };
    tick();
    const onVis = () => { if (!document.hidden) tick(); };
    // A burst of nudges (SSE hint + focus + post-write) is one version check.
    const onNudge = () => { clearTimeout(nudgeTimer); nudgeTimer = setTimeout(tick, 150); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    window.addEventListener('chugaz-nudge', onNudge);
    return () => {
      stopped = true;
      clearTimeout(nudgeTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.removeEventListener('chugaz-nudge', onNudge);
    };
  }, []);
  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
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
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  );
}