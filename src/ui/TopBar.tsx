import { lazy, Suspense } from 'react';

const StatusRow = lazy(() => import('./Status'));

export function TopBar({ route }: { route: string }) {
  return (
    <header className={`topbar${route === '/audit' ? ' wide' : ''}`}>
      <a className="brand" href="#/">Blindfold</a>
      <nav>
        <a href="#/">Overview</a>
        <a href="#/how">How it works</a>
        <a href="#/audit">Audit</a>
      </nav>
      <div className="spacer" />
      {/* the landing page has one call to action, in the hero; the audit page shows live status here */}
      {route === '/audit' && <Suspense fallback={null}><StatusRow /></Suspense>}
    </header>
  );
}
