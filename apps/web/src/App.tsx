import { Suspense, lazy, type ComponentType } from 'react'
import Landing from './applicant/Landing.tsx'
import { NotFound } from './applicant/NotFound.tsx'
import Packet from './applicant/Packet.tsx'
import Workspace from './applicant/Workspace.tsx'
import { usePathname } from './lib/nav.ts'

// Kris drops his screen at ./office/index.tsx. The glob stays empty until then, so nothing here changes.
const officeModules = import.meta.glob<{ default: ComponentType<{ id: string }> }>('./office/index.tsx')
const loadOffice = officeModules['./office/index.tsx']
const Office = loadOffice ? lazy(loadOffice) : null

const DevScreen = import.meta.env.DEV ? lazy(() => import('./dev/DevScreen.tsx')) : null

export default function App() {
  const [, section, id, view] = usePathname().replace(/\/+$/, '').split('/')

  if (!section) return <Landing />

  if (section === 'permits' && id && !view) return <Workspace key={id} id={id} />
  if (section === 'permits' && id && view === 'packet') return <Packet key={id} id={id} />

  if (section === 'office' && id) {
    if (!Office) return <NotFound title="Office screen not installed" body="This build has no office screen yet." />
    return (
      <Suspense fallback={null}>
        <Office key={id} id={id} />
      </Suspense>
    )
  }

  if (section === 'dev' && DevScreen) {
    return (
      <Suspense fallback={null}>
        <DevScreen state={id ?? ''} view={view} />
      </Suspense>
    )
  }

  return <NotFound />
}
