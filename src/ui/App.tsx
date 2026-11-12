import { lazy, Suspense, useEffect, useState } from 'react';
import { Landing } from './Landing';
import { TopBar } from './TopBar';

// The audit (and with it Firebase, App Check and the AI SDK) loads only when someone opens it.
const AuditPage = lazy(() => import('./Audit').then(m => ({ default: m.AuditPage })));

function useRoute(): string {
  const read = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => { setR(read()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    if (route === '/how') document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' });
  }, [route]);
  return (
    <>
      <TopBar route={route} />
      {route === '/audit' ? <Suspense fallback={<div className="main start" />}><AuditPage /></Suspense> : <Landing />}
    </>
  );
}
