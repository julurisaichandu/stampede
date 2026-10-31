// Run once per workspace. Tokens are returned only here; a second run fails with name_conflict.
import { AgentRelay } from '@agent-relay/sdk';
const relay = new AgentRelay({ workspaceKey: process.env.RELAY_WORKSPACE_KEY!, baseUrl: process.env.RELAY_BASE_URL });
for (const name of ['intake', 'clerk', 'building', 'zoning']) {
  const agent = await relay.workspace.register({ name, type: 'agent' });
  console.log(`RELAY_${name.toUpperCase()}_TOKEN=${agent.token}`);
}
