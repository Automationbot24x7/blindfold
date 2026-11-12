import { useDevice, useOnline } from '../lib/device';
import { useReplaying } from '../lib/replayState';

/* Status labels for the audit page: a filled square means ready, an outlined one means missing or not yet.
   Loaded only on the audit page, so the landing page never starts Firebase or App Check. */
function DevicePill() {
  const d = useDevice();
  if (d.status === 'available') return <span className="pill">On-device AI ready</span>;
  if (d.status === 'downloading') return <span className="pill off">On-device AI {Math.round(d.progress * 100)}%</span>;
  if (d.status === 'downloadable') return <span className="pill warn">On-device AI not downloaded</span>;
  if (d.status === 'checking') return <span className="pill off">Checking device</span>;
  return <span className="pill warn">No on-device AI in this browser</span>;
}

function NetworkPill() {
  const online = useOnline();
  return online ? <span className="pill">Online</span> : <span className="pill warn">Offline</span>;
}

export default function StatusRow() {
  const replaying = useReplaying();
  return (
    <div className="status-row">
      {replaying ? <span className="pill">Recorded run</span> : <DevicePill />}
      <NetworkPill />
    </div>
  );
}
