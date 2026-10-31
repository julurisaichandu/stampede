// Run from apps/api: npx tsx ../web/src/lib/usePermit.check.ts
import { mergeFrame } from './usePermit.ts'

function expect(ok: boolean, name: string) {
  if (!ok) throw new Error(`failed: ${name}`)
}

const first = mergeFrame('a', null, { type: 'state', state: { revision: 2 } })
expect(first?.id === 'a' && first.revision === 2 && first.status === 'INTAKE', 'state fills over the empty permit')

const updated = mergeFrame('a', first, { type: 'state_update', changes: { revision: 3 } })
expect(updated?.revision === 3 && updated.status === 'INTAKE', 'state_update merges')

const removed = mergeFrame('a', updated, { type: 'state_update', changes: {}, removed: ['revision', 'nope'] })
expect(removed?.revision === 1 && !('nope' in (removed ?? {})), 'removed restores the default and ignores unknown keys')

expect(mergeFrame('a', updated, { type: 'event' }) === updated, 'broadcast frames change nothing')
expect(mergeFrame('a', null, { type: 'event' }) === null, 'a broadcast before state leaves nothing to render')

console.log('usePermit check passed')
