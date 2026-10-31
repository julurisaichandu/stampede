import { EMPTY_DECK, emptyPermit } from '../../../api/contracts.ts'
import type { ChatMessage, Deck, Finding, PermitApplication, PermitEvent, Property, RelayLogEntry } from '../../../api/contracts.ts'
import type { GisLookup } from '../../../api/src/api-types.ts'

const ID = 'dev-permit'
const at = (time: string) => `2026-10-31T${time}:00.000Z`

const DECKS_PAGE =
  'https://www.sanjoseca.gov/businesses/development-services-permit-center/start-your-project/single-family-duplex-properties/decks'
const CRC_CHAPTER_3 = 'https://up.codes/viewer/california/ca-residential-code-2025/chapter/3/building-planning'
const MUNICIPAL_CODE = 'https://library.municode.com/ca/san_jose/codes/code_of_ordinances'

const property: Property = {
  address: '14630 Noble Ave, San Jose, California, 95132',
  lat: 37.393866,
  lng: -121.838022,
  apn: '59531001',
  parcelId: '103252',
  zoning: 'R-1-8',
  zoningBase: 'R-1-8',
  zoningOverlay: null,
  rezoningFile: null,
  lookupConfidence: 100,
  source: 'live',
  fetchedAt: at('19:52'),
}

const chatDeck: Deck = { ...EMPTY_DECK, lengthFt: 16, widthFt: 12 }
const fullDeck: Deck = { ...chatDeck, maxHeightIn: 36, attached: true, guardHeightIn: 36 }
const revisedDeck: Deck = { ...fullDeck, guardHeightIn: 42 }

const say = (role: ChatMessage['role'], time: string, content: string): ChatMessage => ({ role, content, at: at(time) })

const greeting = say('assistant', '19:51', "Tell me about the deck you want to build. I'll start with the address.")
const firstAsk = say('user', '19:52', 'I want a backyard deck at 14630 Noble Ave, San Jose, about 16 by 12 feet.')
const firstReply = say(
  'assistant',
  '19:52',
  'Found your parcel on the city map. A 16 by 12 foot deck is 192 square feet. Will it be attached to the house?',
)
const secondAsk = say('user', '19:53', 'attached, about 36 inches high, railing 36 inches.')
const secondReply = say(
  'assistant',
  '19:53',
  'Thanks, that covers the minimum. Your summary is on the right. Run pre-review when it looks correct.',
)
const correctionNote = say(
  'assistant',
  '19:55',
  'One correction: your railing is 36 inches, and 2025 CRC R321.1.2 needs at least 42 inches because the deck is more than 30 inches above grade. Tell me the new railing height and I will send a revision.',
)
const fix = say('user', '19:56', "I'll make the railing 42 inches.")
const fixReply = say('assistant', '19:56', 'Revision 2 submitted. The reviewers are rechecking the railing now.')

const intake = (done: boolean, missingFields: string[] = []): PermitApplication['intake'] => ({
  complete: done,
  missingFields,
  unknownFields: [],
  confirmedAt: done ? at('19:54') : null,
})

function finding(
  revision: number,
  rule: Pick<Finding, 'ruleId' | 'reviewer' | 'status' | 'field' | 'observed' | 'required' | 'reason' | 'citation' | 'sourceUrl' | 'evidence'> &
    Partial<Pick<Finding, 'humanReviewNeeded'>>,
): Finding {
  return { humanReviewNeeded: false, ...rule, revision, findingId: `${ID}:${revision}:${rule.ruleId}` }
}

const permitRule = finding(1, {
  ruleId: 'SJ-PERMIT-01',
  reviewer: 'building',
  status: 'PASS',
  field: 'deck.attached',
  observed: true,
  required: null,
  reason: 'A building permit is required: 36 in above grade (≥ 30 in at any point), attached to the dwelling.',
  citation: 'San Jose Decks page',
  sourceUrl: DECKS_PAGE,
  evidence: ['A deck installation, replacement, or repair requires a building permit if any of these conditions apply.'],
})

const guardShared: Pick<Finding, 'ruleId' | 'reviewer' | 'field' | 'required' | 'citation' | 'sourceUrl' | 'evidence'> = {
  ruleId: 'CRC-GUARD-01',
  reviewer: 'building',
  field: 'deck.guardHeightIn',
  required: '42 in',
  citation: '2025 CRC R321.1.1 and R321.1.2',
  sourceUrl: CRC_CHAPTER_3,
  evidence: ['Required guards at open-sided walking surfaces shall be not less than 42 inches in height.'],
}

const guardRule = finding(1, {
  ...guardShared,
  status: 'CORRECTION',
  observed: 36,
  reason:
    'Guard 36 in. 2025 CRC R321.1.2 requires not less than 42 in where the walking surface is more than 30 in above grade (R321.1.1).',
})

const guardFixed = finding(2, {
  ...guardShared,
  status: 'PASS',
  observed: 42,
  reason: 'Guard 42 in meets the 42 in minimum.',
})

const detailRule = finding(1, {
  ruleId: 'SJ-DETAIL-01',
  reviewer: 'building',
  status: 'NEEDS_INFORMATION',
  field: 'deck.ledgerType',
  observed: null,
  required: 'Framing, footing and ledger connection details',
  reason: 'Ledger attachment not described.',
  citation: 'San Jose Plan Set Instructions, Form 352',
  sourceUrl: DECKS_PAGE,
  evidence: ['This rule checks that the details are present, not that they are structurally adequate.'],
})

const zoningRule = finding(1, {
  ruleId: 'SJ-ZONING-01',
  reviewer: 'zoning',
  status: 'NEEDS_HUMAN_VERIFICATION',
  field: 'deck.rearSetbackFt',
  observed: null,
  required: null,
  reason:
    'Rear setback for an attached deck in R-1-8 not verified. Check San Jose Municipal Code Ch. 20.30, Table 20-60 (§20.30.200) and §20.30.400 with a City planner.',
  citation: 'San Jose Municipal Code Ch. 20.30, Table 20-60 (§20.30.200) and §20.30.400',
  sourceUrl: MUNICIPAL_CODE,
  evidence: ["Zoning comes from the city's GIS. The setback rule is not verified for this parcel."],
  humanReviewNeeded: true,
})

const event = (time: string, why: string, from: PermitEvent['from'], to: PermitEvent['to']): PermitEvent => ({
  at: at(time),
  who: 'clerk',
  why,
  from,
  to,
})

const toReady = event('19:54', 'Review request received', 'INTAKE', 'READY_FOR_REVIEW')
const toReview = event('19:54', 'Revision 1 frozen', 'READY_FOR_REVIEW', 'IN_REVIEW')
const toCorrections = event('19:55', 'One correction open', 'IN_REVIEW', 'CORRECTIONS_REQUESTED')
const toRevised = event('19:56', 'Revision 2 received', 'CORRECTIONS_REQUESTED', 'REVISED')
const toRereview = event('19:56', 'Revision 2 frozen', 'REVISED', 'IN_REVIEW')
const toComplete = event('19:57', 'No corrections remain', 'IN_REVIEW', 'PRE_REVIEW_COMPLETE')

const log = (time: string, sender: RelayLogEntry['sender'], type: RelayLogEntry['type'], revision: number, text: string): RelayLogEntry => ({
  at: at(time),
  sender,
  type,
  revision,
  text,
})

const reviewLog = [
  log('19:54', 'intake', 'REVIEW_REQUEST', 1, 'Intake sent the application to the Clerk.'),
  log('19:54', 'building', 'FINDING', 1, 'Building confirmed a permit is required.'),
  log('19:55', 'building', 'FINDING', 1, 'Building flagged the railing height.'),
]

const base: PermitApplication = { ...emptyPermit(ID), chat: [greeting] }

const filling: PermitApplication = {
  ...base,
  property,
  deck: chatDeck,
  intake: intake(false, ['deck.maxHeightIn', 'deck.attached']),
  chat: [greeting, firstAsk, firstReply],
}

const ready: PermitApplication = {
  ...filling,
  deck: fullDeck,
  intake: intake(false),
  chat: [...filling.chat, secondAsk, secondReply],
}

const frozenOne = { revision: 1, deck: fullDeck, frozenAt: at('19:54') }
const frozenTwo = { revision: 2, deck: revisedDeck, frozenAt: at('19:56') }

const reviewing: PermitApplication = {
  ...ready,
  status: 'IN_REVIEW',
  intake: intake(true),
  revisions: [frozenOne],
  findings: [permitRule, guardRule],
  events: [toReady, toReview],
  relayLog: reviewLog,
}

const corrections: PermitApplication = {
  ...reviewing,
  status: 'CORRECTIONS_REQUESTED',
  chat: [...ready.chat, correctionNote],
  findings: [permitRule, guardRule, detailRule, zoningRule],
  events: [...reviewing.events, toCorrections],
}

const revising: PermitApplication = {
  ...corrections,
  status: 'REVISED',
  revision: 2,
  deck: revisedDeck,
  chat: [...corrections.chat, fix, fixReply],
  events: [...corrections.events, toRevised],
}

const complete: PermitApplication = {
  ...revising,
  status: 'PRE_REVIEW_COMPLETE',
  revisions: [frozenOne, frozenTwo],
  findings: [...revising.findings, guardFixed],
  events: [...revising.events, toRereview, toComplete],
}

const needsConfirm: PermitApplication = {
  ...base,
  deck: chatDeck,
  intake: intake(false, ['property', 'deck.maxHeightIn', 'deck.attached']),
  chat: [
    greeting,
    say('user', '19:52', 'I want a backyard deck at 200 Santa Clara St, San Jose, about 16 by 12 feet.'),
    say('assistant', '19:52', 'The city has two matches for that address. Which one is yours?'),
  ],
}

export const snapshots: Record<string, PermitApplication> = {
  empty: base,
  filling,
  needsConfirm,
  ready,
  reviewing,
  corrections,
  revising,
  complete,
}

export const needsConfirmLookup: GisLookup = {
  status: 'needs_confirm',
  source: 'live',
  fetchedAt: at('19:52'),
  property: null,
  candidates: [
    { address: '200 E Santa Clara St, San Jose, California, 95113', score: 98, addrType: 'PointAddress', lat: 37.3376, lng: -121.8863, apn: null, parcelId: null, zoning: null },
    { address: '200 W Santa Clara St, San Jose, California, 95113', score: 98, addrType: 'PointAddress', lat: 37.3339, lng: -121.8926, apn: null, parcelId: null, zoning: null },
  ],
}
