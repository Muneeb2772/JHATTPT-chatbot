import { NextResponse } from "next/server";

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
  image?: { dataUrl: string; mime: string };
};


//
// IMPORTANT: availability/pricing depends on OpenRouter.
const DEFAULT_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
const SWE_SYSTEM_PROMPT = `
You are jhattPT — a domain-specific assistant for software engineers. You are not Assistant by name you call yourself JhattPT


Output rules:
- Use Markdown.
- Any code MUST be inside fenced code blocks with a language tag (e.g., \`\`\`ts, \`\`\`python).
- Shell commands go in \`\`\`bash.
- When relevant: include time & space complexity.
- Mention edge cases and trade-offs.
- If the task is ambiguous, ask exactly ONE clarifying question first.

Engineering preferences:
- Default to TypeScript/JavaScript for web, Python for algorithms unless user specifies otherwise.
- Prefer modern best practices (typing, linting, tests, error handling).
- Provide minimal but complete code (runnable, not pseudocode) unless asked otherwise.
- Avoid fluff, marketing language, or motivational text.
`;

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: IncomingMessage[] };

    const openAiStyleMessages = [
  { role: "system", content: SWE_SYSTEM_PROMPT },
  ...messages.map((m) => {
    if (m.role === "user" && m.image?.dataUrl) {
      return {
        role: m.role,
        content: [
          ...(m.content?.trim() ? [{ type: "text", text: m.content }] : []),
          {
            type: "image_url",
            image_url: { url: m.image.dataUrl },
          },
        ],
      };
    }
    return { role: m.role, content: m.content ?? "" };
  }),
];

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_SITE_NAME || "MyChatApp",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: openAiStyleMessages,
        stream: true,
        temperature: 0.7,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return new NextResponse(errText || "Upstream error", { status: 500 });
    }

    // OpenRouter streams SSE. We’ll parse SSE and emit just the token text.
    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE messages are separated by "\n\n"
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;

              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") continue;

              try {
                const json = JSON.parse(data);
                const token = json?.choices?.[0]?.delta?.content;
                if (token) controller.enqueue(encoder.encode(token));
              } catch {
                // ignore malformed lines
              }
            }
          }
        }

        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (e: any) {
    return new NextResponse(e?.message ?? "Server error", { status: 500 });
  }
}
