import type { Finding, FindingStatus, PermitApplication } from '../../../api/contracts.ts'

export type FindingCopy = { title: string; note?: string; wrong?: string; change?: string }
type Context = Pick<PermitApplication, 'deck' | 'property'>
type Rule = {
  label: string
  reviewer: Finding['reviewer']
  byStatus: Partial<Record<FindingStatus, (finding: Finding, context: Context) => FindingCopy>>
}

export const STATUS_PILL: Record<FindingStatus, { label: string; tone: string }> = {
  PASS: { label: 'PASS', tone: 'pass' },
  CORRECTION: { label: 'CORRECTION', tone: 'correction' },
  NEEDS_INFORMATION: { label: 'NEEDS INFORMATION', tone: 'needs-info' },
  NEEDS_HUMAN_VERIFICATION: { label: 'NEEDS HUMAN VERIFICATION', tone: 'needs-human' },
}

// The office's observed and required are free-form ("42 in", 42, null), so anything unreadable is NaN.
const measure = (value: Finding['observed']) => parseFloat(String(value))

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

export const RULES: Record<string, Rule> = {
  'SJ-PERMIT-01': {
    label: 'Building permit',
    reviewer: 'building',
    byStatus: {
      PASS: ({ reason }) => {
        const [, triggers] = reason.match(/^Permit required:\s*(.+?)\.?$/) ?? []
        if (!triggers) return { title: 'Building permit', note: reason }
        return {
          title: 'Your deck needs a building permit',
          note: `This is normal for a deck like yours, and there is nothing to fix. It applies because of: ${triggers}.`,
        }
      },
    },
  },
  'CRC-GUARD-01': {
    label: 'Railing height',
    reviewer: 'building',
    byStatus: {
      CORRECTION: ({ observed, required, reason }) => {
        const have = measure(observed)
        const need = measure(required)
        const title = 'Your railing needs to be taller'
        if (Number.isNaN(have) || Number.isNaN(need)) {
          return {
            title,
            wrong: reason,
            change: 'Raise the railing to meet this rule, then tell me the new height in the chat and I will send a revision.',
          }
        }
        return {
          title,
          wrong: `Your railing is ${have} inches. Because the deck is more than 30 inches above the ground, the code asks for at least ${need} inches.`,
          change: `Raise the railing to at least ${need} inches, then tell me the new height in the chat and I will send a revision.`,
        }
      },
      NEEDS_INFORMATION: () => ({
        title: 'We need your railing height',
        wrong: 'We do not have a railing height yet, and your deck may be high enough to need one.',
        change: 'Tell me the railing height in the chat.',
      }),
      PASS: ({ observed, required, reason }) => {
        const have = measure(observed)
        const need = measure(required)
        return {
          title: 'Your railing height works',
          note: have >= need ? `Your railing is ${have} inches, which meets the minimum of ${need} inches.` : reason,
        }
      },
    },
  },
  'SJ-DETAIL-01': {
    label: 'Connection details',
    reviewer: 'building',
    byStatus: {
      NEEDS_INFORMATION: ({ required }) => ({
        title: 'Show how the deck connects',
        wrong: 'We do not have the details of how the deck connects yet.',
        change: required ? `Your plans need to show ${lowerFirst(required)}.` : undefined,
      }),
      PASS: () => ({
        title: 'Connection details are noted',
        note: 'You described how the deck attaches. This check confirms the details are there, not that they are structurally adequate.',
      }),
    },
  },
  'SJ-ZONING-01': {
    label: 'Rear setback',
    reviewer: 'zoning',
    byStatus: {
      NEEDS_HUMAN_VERIFICATION: (_, { deck, property }) => {
        const kind = deck.attached ? 'an attached deck' : 'a deck'
        const overlay = property?.zoningOverlay ? ` Overlay ${property.zoningOverlay} also applies.` : ''
        return {
          title: 'A City planner needs to check this one',
          wrong: `We could not verify the rear setback for ${kind} in ${property?.zoningBase ?? 'this district'}.${overlay}`,
          change: 'Check San Jose Municipal Code Ch. 20.30, Table 20-60 (§20.30.200) and §20.30.400 with a City planner.',
        }
      },
    },
  },
}

export const RULE_ORDER = Object.keys(RULES)

export function findingCopy(finding: Finding, context: Context): FindingCopy {
  const rule = RULES[finding.ruleId]
  const write = rule?.byStatus[finding.status]
  if (write) return write(finding, context)
  const title = rule?.label ?? 'Reviewer note'
  return finding.status === 'PASS' ? { title, note: finding.reason } : { title, wrong: finding.reason }
}

export function httpUrl(url: string): string | null {
  try {
    const { protocol, href } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? href : null
  } catch {
    return null
  }
}
