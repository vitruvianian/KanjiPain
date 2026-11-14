import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { ErrorBoundary } from './ErrorBoundary';

export function AppShell() {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const practice = location.pathname === '/practice';

  useEffect(() => {
    document.title = 'KanjiPain';
    if (previousPath.current === location.pathname) {
      return;
    }
    previousPath.current = location.pathname;
    main.current?.focus();
  }, [location.pathname]);

  return (
    <div className={`site-shell${practice ? ' site-shell--practice' : ''}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        {practice ? (
          <span className="brand">KanjiPain</span>
        ) : (
          <>
            <Link className="brand" to="/" aria-label="KanjiPain home">
              KanjiPain
            </Link>
            <nav aria-label="Main navigation">
              <NavLink to="/" end>
                Dojo
              </NavLink>
              <NavLink to="/collection">Collection</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </nav>
          </>
        )}
      </header>
      <main id="main-content" ref={main} tabIndex={-1} className="site-main">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      {practice ? null : (
        <footer className="site-footer">
          <p>Effortful recall. Honest progress.</p>
          <Link to="/sources">Sources &amp; licenses</Link>
        </footer>
      )}
    </div>
  );
}
