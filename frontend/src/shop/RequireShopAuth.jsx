import { Navigate, useLocation } from 'react-router-dom';
import { useShop } from './ShopContext';

export default function RequireShopAuth({ children }) {
  const { user, loading } = useShop();
  const location = useLocation();
  if (loading) {
    return <div className="card" style={{ textAlign: 'center', padding: 40 }}>Verifying session…</div>;
  }
  if (!user) {
    return <Navigate to={`/shop/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return children;
}