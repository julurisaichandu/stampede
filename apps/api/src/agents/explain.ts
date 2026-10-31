// Plain-English line for a finding in the relay feed. The model only rewords the reason; it never sees or sets
// the status, and the finding stored in the actor keeps the rule's own wording. No key or a failed call: original reason.
import type { Finding } from "../../contracts.ts"

const VERDICT: Record<Finding["status"], string> = {
  PASS: "passes",
  CORRECTION: "needs a correction",
  NEEDS_INFORMATION: "needs more information",
  NEEDS_HUMAN_VERIFICATION: "needs a City planner",
}

export async function explain(f: Finding): Promise<string> {
  return `${f.ruleId} ${VERDICT[f.status]}: ${await plainEnglish(f.reason)}`
}

async function plainEnglish(reason: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return reason
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 80,
        messages: [
          {
            role: "system",
            content:
              "Rewrite this building-permit review note for a homeowner in plain English, at most 25 words. " +
              "Keep every number and code reference. Do not say whether it passes or fails.",
          },
          { role: "user", content: reason },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return reason
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content?.trim() || reason
  } catch {
    return reason
  }
}
