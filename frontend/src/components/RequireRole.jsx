import { Navigate, useLocation } from 'react-router-dom';
import { getUser } from '../lib/api';
import { canRole } from '../lib/roles';

export default function RequireRole({ min, children }) {
  const location = useLocation();
  const user = getUser();
  if (!canRole(user, min)) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
  }
  return children;
}
