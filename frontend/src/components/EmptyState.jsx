import { Link } from 'react-router-dom';
import I from './icons';

// Shared empty-list block: friendly icon + human copy (+ optional action).
// Every list screen uses this so "nothing here" always looks designed
// instead of a blank table or a bare sentence.
export default function EmptyState({ icon = 'inbox', title, message, action, onAction, to }) {
  let btn = null;
  if (action) {
    btn = to
      ? <Link to={to} className="btn primary sm">{action}</Link>
      : <button className="btn primary sm" onClick={onAction}>{action}</button>;
  }
  return (
    <div className="empty-state">
      <div className="ico-wrap"><I name={icon} size={24} /></div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {btn}
    </div>
  );
}
