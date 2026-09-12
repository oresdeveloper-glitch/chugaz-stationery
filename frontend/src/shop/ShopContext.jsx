import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getShopUser, setShopAuth, clearShopAuth, shopApi, isShopSessionValid } from '../lib/api';

const ShopCtx = createContext(null);

export function ShopProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (!isShopSessionValid()) { clearShopAuth(); return null; }
    return getShopUser();
  });
  const [cartCount, setCartCount] = useState(0);

  const refreshCart = useCallback(async () => {
    try {
      const cart = await shopApi('/cart');
      setCartCount(cart.count || 0);
    } catch {
      setCartCount(0);
    }
  }, []);

  useEffect(() => {
    refreshCart();
  }, [user, refreshCart]);

  const login = (token, u) => {
    setShopAuth(token, u);
    setUser(u);
  };
  const logout = () => {
    clearShopAuth();
    setUser(null);
    setCartCount(0);
  };

  return (
    <ShopCtx.Provider value={{ user, setUser, login, logout, cartCount, refreshCart }}>
      {children}
    </ShopCtx.Provider>
  );
}

export const useShop = () => useContext(ShopCtx);