import { Suspense, lazy } from 'react'
import Landing from './applicant/Landing.tsx'
import { NotFound } from './applicant/NotFound.tsx'
import Packet from './applicant/Packet.tsx'
import Workspace from './applicant/Workspace.tsx'
import { usePathname } from './lib/nav.ts'

const Office = lazy(() => import('./office/OfficeScreen.tsx').then(({ OfficeScreen }) => ({ default: OfficeScreen })))

const DevScreen = import.meta.env.DEV ? lazy(() => import('./dev/DevScreen.tsx')) : null

export default function App() {
  const [, section, id, view] = usePathname().replace(/\/+$/, '').split('/')

  if (!section) return <Landing />

  if (section === 'permits' && id && !view) return <Workspace key={id} id={id} />
  if (section === 'permits' && id && view === 'packet') return <Packet key={id} id={id} />

  if (section === 'office' && id) {
    return (
      <Suspense fallback={null}>
        <Office key={id} permitId={id} />
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
