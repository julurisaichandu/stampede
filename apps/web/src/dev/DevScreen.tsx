import { PacketView } from '../applicant/Packet.tsx'
import { WorkspaceView } from '../applicant/Workspace.tsx'
import { needsConfirmLookup, snapshots } from './snapshots.ts'

export default function DevScreen({ state, view }: { state: string; view?: string }) {
  const permit = snapshots[state]
  if (!permit) {
    return (
      <main className="empty-screen">
        <h1>Dev snapshots</h1>
        {Object.keys(snapshots).map((name) => (
          <a key={name} href={`/dev/${name}`}>
            {name}
          </a>
        ))}
      </main>
    )
  }
  if (view === 'packet') return <PacketView permit={permit} />
  return <WorkspaceView permit={permit} lookup={state === 'needsConfirm' ? needsConfirmLookup : null} />
}
