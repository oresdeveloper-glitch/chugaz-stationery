import { Navigate, useLocation } from 'react-router-dom';
import { useShop } from './ShopContext';

export default function RequireShopAuth({ children }) {
  const { user } = useShop();
  const location = useLocation();
  if (!user) {
    return <Navigate to={`/shop/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return children;
}