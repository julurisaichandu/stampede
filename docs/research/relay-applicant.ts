import { AgentRelay } from '@agent-relay/sdk';
import { z } from 'zod';

export const Envelope = z.object({
  permitId: z.string(),
  revision: z.number().int(),
  sender: z.string(),
  type: z.enum(['REVIEW_REQUEST', 'FINDING', 'NEEDS_INPUT', 'REVISION_SUBMITTED', 'REVIEW_COMPLETE', 'PACKET_READY']),
  findingId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});
export type Envelope = z.infer<typeof Envelope>;

// RELAY_INTAKE_TOKEN holds the at_live_ token printed by a one-time register; register() is create-only.
const relay = new AgentRelay({
  workspaceKey: process.env.RELAY_WORKSPACE_KEY!,
  baseUrl: process.env.RELAY_BASE_URL, // undefined means https://cast.agentrelay.com; ar_ws_ keys need armadillo
  retryPolicy: { maxRetries: 1 }, // default 3 costs about 7 s against a dead host
  onError: (err, ctx) => console.warn('[relay]', ctx, err),
});
const intake = await relay.workspace.reconnect({ apiToken: process.env.RELAY_INTAKE_TOKEN! });

const channelOf = (permitId: string) => `permit-${permitId}`;

export async function openPermitChannel(permitId: string) {
  // ponytail: create-then-join tolerates the conflict for an existing channel, error code unverified.
  await intake.channels.create({ name: channelOf(permitId), topic: `Permit ${permitId}` }).catch(() => {});
  await intake.channels.join(channelOf(permitId));
  for (const agent of ['clerk', 'building', 'zoning']) {
    await intake.channels.invite(channelOf(permitId), agent).catch((err) => console.warn('[relay] invite', agent, err));
  }
}

// Returns false when Relay is unavailable; the actor call has already happened.
export async function post(e: Omit<Envelope, 'sender' | 'timestamp'>): Promise<boolean> {
  const envelope: Envelope = { ...e, sender: 'intake', timestamp: new Date().toISOString() };
  try {
    const sent = intake.sendMessage({
      to: `#${channelOf(e.permitId)}`,
      text: JSON.stringify(envelope), // fallback if metadata does not survive delivery (unverified)
      metadata: envelope,
      idempotencyKey: `${e.permitId}:${e.revision}:${e.type}:${e.findingId ?? '-'}`,
    });
    // The SDK sets no fetch timeout, so bound it here.
    await Promise.race([sent, new Promise((_, no) => setTimeout(() => no(new Error('relay timeout')), 4000))]);
    return true;
  } catch (err) {
    console.warn('[relay] post failed', err);
    return false;
  }
}

function readEnvelope(metadata: unknown, text: string): unknown {
  if (metadata && typeof metadata === 'object' && 'type' in metadata) return metadata;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const seen = new Set<string>();
export function onNeedsInput(handler: (e: Envelope) => void | Promise<void>) {
  return relay.addListener('message.created', async ({ message, envelope }) => {
    if (!envelope.channel?.name?.startsWith('permit-')) return;
    if (envelope.from?.name !== 'clerk' || seen.has(message.messageId)) return;
    const parsed = Envelope.safeParse(readEnvelope(message.metadata, message.text));
    if (!parsed.success || parsed.data.type !== 'NEEDS_INPUT') return;
    seen.add(message.messageId); // ponytail: in-memory dedupe, the actor's revision check is the real guard
    await handler(parsed.data);
  });
}
