import { useEffect, useState } from 'react';
import { AuditPage } from './Audit';
import { Landing } from './Landing';
import { TopBar } from './TopBar';

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
      {route === '/audit' ? <AuditPage /> : <Landing />}
    </>
  );
}
