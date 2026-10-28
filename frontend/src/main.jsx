import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { getToken, isSessionValid, prefetch } from './lib/api';
import { applyTheme, getTheme } from './theme';
import './styles.css';
import './premium.css';
import './mobile.css';
import './print.css';

applyTheme(getTheme());

// The dashboard is the landing route, and both its code and its data used to
// wait for the shell to mount and render: the chunk was only requested after
// React's first commit, and the KPI fetch only after that chunk arrived. On a
// normal connection that is two full round trips of dead time before the page
// can even draw its skeleton. Start both now, in parallel with the shell.
// The Dashboard's own load() calls the same URL, and api() collapses identical
// in-flight GETs, so this costs exactly zero extra requests.
const PATH = window.location.pathname;
const LANDING = PATH === '/' || PATH === '/dashboard';
// Warm the dashboard chunk on the login screen too: it is the page every
// session lands on, and fetching it while the user types their password takes
// a round trip out of the sign-in path.
if (LANDING || PATH === '/login') {
  import('./pages/Dashboard.jsx').catch(() => { /* real navigation will retry */ });
}
// Only prefetch data when a session already exists and we are going straight
// to the dashboard; api() hands the answer to the page's own load().
if (LANDING && isSessionValid() && getToken()) {
  prefetch('/reports/dashboard?range=month');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);