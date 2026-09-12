import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import I from '../../components/icons';

const SLIDES = [
  {
    icon: 'store',
    title: 'Welcome to CHUGAZ STATIONERY',
    desc: 'Your trusted stationery shop in Mbeya — quality products for school, office and business.',
  },
  {
    icon: 'box',
    title: 'Browse & Order Easily',
    desc: '1,000+ items: pens, books, reams, files and more. Add to cart in one tap.',
  },
  {
    icon: 'truck',
    title: 'Fast Delivery or Pickup',
    desc: 'Get it delivered to your door or pick up at our shop. Pay with M-Pesa, Airtel, Yas or HaloPesa.',
  },
];

export default function Splash() {
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const last = idx === SLIDES.length - 1;

  const next = () => {
    if (last) {
      localStorage.setItem('shop_splash_seen', '1');
      nav('/shop/login');
    } else setIdx(idx + 1);
  };
  const skip = () => {
    localStorage.setItem('shop_splash_seen', '1');
    nav('/shop/login');
  };

  const s = SLIDES[idx];
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div style={{ height: 3, background: 'var(--border)', width: '100%' }}>
        <div style={{ height: '100%', width: `${((idx + 1) / SLIDES.length) * 100}%`, background: 'var(--primary)', transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', maxWidth: 400, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <img src="/logo.png?v=5" alt="CHUGAZ" style={{ height: 26, objectFit: 'contain' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'var(--muted)', background: 'var(--panel)', border: '1px solid var(--border)', padding: '4px 8px', borderRadius: 6 }}>{idx + 1} / {SLIDES.length}</span>
          {!last ? <button onClick={skip} style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 12px', borderRadius: 6 }}>Skip</button> : <span style={{ width: 52 }} />}
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '16px 20px 20px', width: '100%', maxWidth: 400, margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 24px 24px', textAlign: 'center' }}>
          <div style={{ width: 96, height: 96, borderRadius: 20, background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--primary)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
            <I name={s.icon} size={42} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--primary-soft, rgba(146,64,14,0.1))', color: 'var(--primary)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 6, marginBottom: 12, border: '1px solid var(--border)' }}>CHUGAZ STATIONERY • MBEYA</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.25, margin: '0 0 10px', letterSpacing: '-0.015em', color: 'var(--text)' }}>{s.title}</h1>
          <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: '0 0 22px', color: 'var(--muted)', minHeight: 44 }}>{s.desc}</p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 22 }}>
            {SLIDES.map((_, i) => (
              <span key={i} style={{ width: i === idx ? 28 : 8, height: 8, borderRadius: 999, background: i === idx ? 'var(--primary)' : 'var(--border)', transition: 'all 0.25s ease', display: 'inline-block' }} />
            ))}
          </div>

          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 14, fontWeight: 700, borderRadius: 8 }} onClick={next}>
            {last ? 'Get Started' : 'Continue'} <I name={last ? 'check' : 'chevDown'} size={16} style={{ marginLeft: 8, transform: last ? 'none' : 'rotate(-90deg)' }} />
          </button>

          {last ? (
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Link to="/shop/login" onClick={() => localStorage.setItem('shop_splash_seen','1')} className="btn" style={{ justifyContent: 'center', padding: '12px', fontWeight: 600 }}>Sign in</Link>
              <Link to="/shop/register" onClick={() => localStorage.setItem('shop_splash_seen','1')} className="btn primary" style={{ justifyContent: 'center', padding: '12px', fontWeight: 600 }}>Create account</Link>
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><span style={{ width: 16, height: 1, background: 'var(--border)', display: 'inline-block' }} /> Swipe to continue <span style={{ width: 16, height: 1, background: 'var(--border)', display: 'inline-block' }} /></div>
          )}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 16, fontSize: 10, fontWeight: 600, letterSpacing: '.07em', color: 'var(--muted)', textAlign: 'center' }}>
          <span>500+ PRODUCTS</span><span style={{ color: 'var(--border)' }}>•</span><span>CASH/M-PESA</span><span style={{ color: 'var(--border)' }}>•</span><span>DELIVERY</span>
        </div>
      </div>
    </div>
  );
}
