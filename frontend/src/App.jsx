import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { getUser, clearAuth, isSessionValid } from './lib/api';
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
import ShopLogin from './pages/shop/ShopLogin.jsx';
import ShopRegister from './pages/shop/ShopRegister.jsx';
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
          <Route path="login" element={<ShopLogin />} />
          <Route path="register" element={<ShopRegister />} />
          <Route path="*" element={<Navigate to="/shop" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}