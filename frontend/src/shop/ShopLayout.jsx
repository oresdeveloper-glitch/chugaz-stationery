import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import { useShop } from './ShopContext';
import { shopApi } from '../lib/api';
import { applyTheme } from '../theme';
import I from '../components/icons';

export default function ShopLayout() {
  const { user, logout, cartCount } = useShop();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    shopApi('/info').then((info) => { if (info.theme) applyTheme(info.theme); }).catch(() => {});
  }, []);

  const location = useLocation();
  useEffect(() => {
    if (!user && !localStorage.getItem('shop_splash_seen') && location.pathname === '/shop') {
      navigate('/shop/welcome', { replace: true });
    }
  }, [user, location.pathname]);

  const hideChrome = ['/shop/welcome', '/shop/login', '/shop/register'].includes(location.pathname);

  const search = (e) => {
    e.preventDefault();
    navigate(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div style={{ minHeight: '100vh', background: hideChrome ? '#f1f5f9' : 'var(--bg)' }}>
      {!hideChrome && (
      <div className="shop-topbar">
        <button className="shop-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu"><I name="menu" size={20} /></button>
        <Link to="/shop" className="shop-brand"><span className="shop-brand-logo"><img src="/logo-classic.svg?v=1" alt="CHUGAZ STATIONERY" /></span><span className="shop-brand-text"><span className="shop-brand-slide">CHUGAZ STATIONERY</span></span></Link>
        <form className="shop-search" onSubmit={search}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, SKU or barcode..." />
          <button className="btn primary sm">Search</button>
        </form>
        <div className="shop-nav">
          <Link to="/shop/cart" className="shop-link cart-link">
            <I name="cart" size={19} /> <span className="cart-count">{cartCount || ''}</span>
          </Link>
          {user ? (
            <div className="shop-user">
              <span className="shop-link">{user.name.split(' ')[0]}</span>
              <div className="shop-dropdown">
                <Link to="/shop/profile">Profile</Link>
                <Link to="/shop/addresses">Addresses</Link>
                <button className="btn sm" onClick={() => { logout(); navigate('/shop'); }}>Log out</button>
              </div>
            </div>
          ) : (
            <Link to="/shop/login" className="btn sm primary">Sign in</Link>
          )}
        </div>
      </div>
      )}
      {!hideChrome && <div className={`shop-drawer-scrim ${menuOpen ? 'open' : ''}`} onClick={closeMenu} />}
      {!hideChrome && <aside className={`shop-drawer ${menuOpen ? 'open' : ''}`} aria-label="Side menu">
        <div className="shop-drawer-head">
          <span className="shop-drawer-brand"><img src="/logo-classic.svg?v=1" alt="CHUGAZ STATIONERY" /> CHUGAZ STATIONERY</span>
          <button className="shop-drawer-close" onClick={closeMenu} aria-label="Close menu"><I name="x" size={18} /></button>
        </div>
        <nav className="shop-side-nav">
          <div className="shop-side-label">Shop</div>
          <NavLink to="/shop" className="shop-side-link" end onClick={closeMenu}><span className="shop-side-ico"><I name="store" size={17} /></span><span>Catalog</span><span className="shop-side-chev"><I name="chevDown" size={13} style={{ transform: 'rotate(-90deg)' }} /></span></NavLink>
          <NavLink to="/shop/cart" className="shop-side-link" onClick={closeMenu}><span className="shop-side-ico"><I name="cart" size={17} /></span><span>My cart</span>{cartCount > 0 && <span className="shop-side-badge">{cartCount}</span>}<span className="shop-side-chev"><I name="chevDown" size={13} style={{ transform: 'rotate(-90deg)' }} /></span></NavLink>
          <NavLink to="/shop/orders" className="shop-side-link" onClick={closeMenu}><span className="shop-side-ico"><I name="bag" size={17} /></span><span>My orders</span><span className="shop-side-chev"><I name="chevDown" size={13} style={{ transform: 'rotate(-90deg)' }} /></span></NavLink>

          {user && (
            <>
              <div className="shop-side-label">My account</div>
              <NavLink to="/shop/profile" className="shop-side-link" onClick={closeMenu}><span className="shop-side-ico"><I name="user" size={17} /></span><span>Profile</span><span className="shop-side-chev"><I name="chevDown" size={13} style={{ transform: 'rotate(-90deg)' }} /></span></NavLink>
              <NavLink to="/shop/addresses" className="shop-side-link" onClick={closeMenu}><span className="shop-side-ico"><I name="pin" size={17} /></span><span>Addresses</span><span className="shop-side-chev"><I name="chevDown" size={13} style={{ transform: 'rotate(-90deg)' }} /></span></NavLink>
            </>
          )}

          <div className="shop-side-label">Support</div>
          <NavLink to="/shop/contact" className="shop-side-link" onClick={closeMenu}><span className="shop-side-ico"><I name="mail" size={17} /></span><span>Contact us</span><span className="shop-side-chev"><I name="chevDown" size={13} style={{ transform: 'rotate(-90deg)' }} /></span></NavLink>

          {!user && (
            <div className="shop-side-cta">
              <Link to="/shop/login" className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={closeMenu}>Sign in</Link>
              <Link to="/shop/register" className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={closeMenu}>Create account</Link>
            </div>
          )}
        </nav>
        <div className="shop-drawer-foot">
          {user ? (
            <div className="shop-user-card">
              <div className="shop-avatar">{user.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}</div>
              <div className="shop-user-meta">
                <div className="shop-drawer-user">{user.name}</div>
                <div className="shop-drawer-user-mail">{user.email}</div>
              </div>
              <button
                className="shop-drawer-logout"
                title="Log out"
                onClick={() => { logout(); navigate('/shop'); }}
              >
                <I name="power" size={16} />
              </button>
            </div>
          ) : (
            <div className="shop-user-card">
              <div className="shop-avatar">?</div>
              <div className="shop-user-meta">
                <div className="shop-drawer-user">Guest</div>
                <div className="shop-drawer-user-mail">Not signed in</div>
              </div>
            </div>
          )}
        </div>
      </aside>}
      <div className="shop-shell" style={{ paddingTop: hideChrome ? 0 : undefined, paddingBottom: hideChrome ? 0 : undefined }}>
        <main className="shop-main" style={{ maxWidth: 900, margin: '0 auto', padding: hideChrome ? 0 : 20 }}>
          <Outlet />
          {!hideChrome && <div style={{ textAlign: 'center', padding: '26px 0 10px', fontSize: 11, color: 'var(--muted-2)', letterSpacing: '0.08em' }}>
            STATIONERY SHOP · VERSION 3.0
          </div>}
        </main>
      </div>
      {!hideChrome && <nav className="shop-bottom-nav" aria-label="Mobile shop navigation">
        <div className="shop-bottom-nav-inner">
          <NavLink to="/shop" end className={({isActive})=> isActive?'active':''}><span className="ico"><I name="store" size={18}/></span><span>Shop</span></NavLink>
          <NavLink to="/shop/cart" className={({isActive})=> isActive?'active':''}><span className="nav-item"><span className="ico"><I name="cart" size={18}/></span>{cartCount>0 && <span className="cart-badge">{cartCount}</span>}</span><span>Cart</span></NavLink>
          <NavLink to="/shop/orders" className={({isActive})=> isActive?'active':''}><span className="ico"><I name="bag" size={18}/></span><span>Orders</span></NavLink>
          <NavLink to={user?"/shop/profile":"/shop/login"} className={({isActive})=> isActive?'active':''}><span className="ico"><I name="user" size={18}/></span><span>{user?"Account":"Sign in"}</span></NavLink>
        </div>
      </nav>}
    </div>
  );
}