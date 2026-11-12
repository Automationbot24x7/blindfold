import { Cloud, CloudOff, Cpu, Download, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useDevice, useOnline } from '../lib/device';

export function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#101318" />
      <rect x="5" y="12.5" width="22" height="7" rx="2" fill="#FAF9F6" />
      <rect x="5" y="22" width="13" height="2.4" rx="1.2" fill="#5EEAD4" />
      <rect x="5" y="7.6" width="9" height="2.4" rx="1.2" fill="#6B7280" />
    </svg>
  );
}

export function DevicePill() {
  const d = useDevice();
  if (d.status === 'available') return <span className="pill device"><Cpu />On-device AI ready</span>;
  if (d.status === 'downloading') return <span className="pill device"><Loader2 className="spin" />On-device AI {Math.round(d.progress * 100)}%</span>;
  if (d.status === 'downloadable') return <span className="pill warn"><Download />On-device AI not downloaded</span>;
  if (d.status === 'checking') return <span className="pill"><Loader2 className="spin" />Checking device</span>;
  return <span className="pill warn"><CloudOff />No on-device AI in this browser</span>;
}

export function NetworkPill() {
  const online = useOnline();
  return online
    ? <span className="pill"><Wifi />Online</span>
    : <span className="pill warn"><WifiOff />Offline</span>;
}

export function TopBar({ route }: { route: string }) {
  return (
    <header className="topbar">
      <a className="brand" href="#/"><Logo />Blindfold</a>
      <nav>
        <a href="#/">Overview</a>
        <a href="#/audit">Audit</a>
        <a href="#/how">How it works</a>
      </nav>
      <div className="spacer" />
      <div className="status-row">
        <DevicePill />
        <NetworkPill />
        {route !== '/audit' && <a className="btn primary sm" href="#/audit"><Cloud />Open the audit</a>}
      </div>
    </header>
  );
}
