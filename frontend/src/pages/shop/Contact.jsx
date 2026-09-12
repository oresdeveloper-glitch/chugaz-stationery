import { useEffect, useState } from 'react';
import { shopApi } from '../../lib/api';
import { useToast } from '../../components/Toast';
import I from '../../components/icons';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', subject: 'Product inquiry', message: '' });
  const [info, setInfo] = useState(null);
  const [sending, setSending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    shopApi('/info').then(setInfo).catch(() => {});
  }, []);

  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      await shopApi('/contact', { method: 'POST', body: form });
      toast('Message sent! We will get back to you.');
      setForm({ ...form, message: '' });
    } catch (err) { toast(err.message, 'error'); }
    finally { setSending(false); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Contact us</h1>
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <p className="muted small">Questions about an order, a product, or a delivery? Send us a message and we will reply by email.</p>
        {info && (
          <div className="muted small" style={{ lineHeight: 1.9, marginBottom: 16 }}>
            <div><I name="pin" size={15} /> {info.shop_address || 'N/A'}</div>
            <div><I name="phone" size={15} /> {info.shop_phone}</div>
            <div><I name="mail" size={15} /> {info.shop_email}</div>
          </div>
        )}
        <form onSubmit={send}>
          <div className="form-row">
            <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="field"><label>Email *</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          </div>
          <div className="field"><label>Subject</label>
            <select value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
              {['Product inquiry', 'Order support', 'Delivery question', 'Returns / refunds', 'Feedback', 'Other'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field"><label>Message *</label><textarea rows="4" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required /></div>
          <button className="btn primary" disabled={sending}>{sending ? 'Sending...' : 'Send message'}</button>
        </form>
      </div>
      <div className="card">
        <h2>Our policies</h2>
        <div className="muted small" style={{ lineHeight: 2 }}>
          <div><b>Delivery:</b> usually 1:3 working days within town, 2:5 for outlying areas.</div>
          <div><b>Free delivery</b> over {info ? info.free_delivery_threshold : 'a set'} amount.</div>
          <div><b>Returns:</b> within 7 days of delivery for unused items.</div>
          <div><b>Payments:</b> cash on delivery, at shop, card, mobile money, bank transfer, or on credit account.</div>
        </div>
      </div>
      </div>
    </div>
  );
}