import OpenAI, { APIConnectionTimeoutError, APIError, RateLimitError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { IntakeTurn } from "./intake-schema.mts";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type IntakeResult =
  | { ok: true; turn: IntakeTurn }
  | { ok: false; reason: "refused" | "incomplete" | "invalid" | "busy" | "unavailable"; detail?: string };

const MODEL = process.env.OPENAI_INTAKE_MODEL ?? "gpt-6-luna";
const format = zodTextFormat(IntakeTurn, "intake_turn");

export async function extractTurn(client: OpenAI, instructions: string, messages: ChatMessage[]): Promise<IntakeResult> {
  try {
    const res = await client.responses.parse(
      {
        model: MODEL,
        store: false,
        instructions,
        input: messages,
        reasoning: { effort: "none" },
        max_output_tokens: 1200,
        text: { format },
      },
      { timeout: 15_000, maxRetries: 1 },
    );
    if (res.status === "incomplete") return { ok: false, reason: "incomplete", detail: res.incomplete_details?.reason };
    for (const item of res.output) {
      if (item.type !== "message") continue;
      for (const c of item.content) if (c.type === "refusal") return { ok: false, reason: "refused", detail: c.refusal };
    }
    return res.output_parsed ? { ok: true, turn: res.output_parsed } : { ok: false, reason: "invalid" };
  } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError) return { ok: false, reason: "invalid", detail: e.message };
    if (e instanceof RateLimitError) return { ok: false, reason: "busy" };
    if (e instanceof APIConnectionTimeoutError || e instanceof APIError) return { ok: false, reason: "unavailable", detail: e.message };
    throw e;
  }
}
