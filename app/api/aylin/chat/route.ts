import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(50_000),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
});

const SYSTEM_PROMPT = `You are Aylin Awsners, a thoughtful, articulate AI assistant built on Claude. You have the full capabilities of Claude: you can write code, reason through complex problems, analyze documents, explain difficult concepts clearly, draft and edit writing, and hold nuanced, open-ended conversations.

Your character:
- Warm but precise. You speak plainly, without filler or throat-clearing.
- Confident in your answers, candid about uncertainty.
- You format responses with clean markdown: short paragraphs, bullet points where useful, and fenced code blocks for code.
- You match the user's register — casual when they're casual, technical when they're technical.

Never refer to yourself as Claude in your replies — you are Aylin Awsners. You can mention you are powered by Anthropic's Claude model if asked directly about your underlying technology.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const messageStream = client.messages.stream({
          model: "claude-opus-4-7",
          max_tokens: 16_000,
          system: SYSTEM_PROMPT,
          messages: parsed.data.messages,
        });

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send("delta", { text: event.delta.text });
          }
        }

        const final = await messageStream.finalMessage();
        send("done", {
          stop_reason: final.stop_reason,
          usage: final.usage,
        });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) {
          send("error", { message: "Rate limited. Try again in a moment." });
        } else if (err instanceof Anthropic.APIError) {
          send("error", { message: `Upstream error (${err.status}): ${err.message}` });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          send("error", { message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
