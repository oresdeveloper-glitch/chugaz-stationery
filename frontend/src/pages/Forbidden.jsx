import { Link, useLocation } from 'react-router-dom';
import { getUser } from '../lib/api';
import { PAGE_ROLES, ROLE_LEVEL } from '../lib/roles';
import I from '../components/icons';

export default function Forbidden() {
  const location = useLocation();
  const user = getUser();
  const path = location.state?.from || '';
  const needed = PAGE_ROLES[path];

  return (
    <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center', padding: 36 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}><I name="lock" size={46} /></div>
      <h1 style={{ marginTop: 8 }}>Access denied</h1>
      <p className="muted">
        Your account <b>{user?.role}</b> doesn't have permission to view this page.
        {needed && <> It requires at least <b>{needed}</b> access (role level {ROLE_LEVEL[needed]}).</>}
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
        <Link to="/" className="btn primary">Go to dashboard</Link>
      </div>
    </div>
  );
}
