import { NextResponse } from "next/server";

const TEXT_MODEL = "arcee-ai/trinity-large-preview:free";
const VISION_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
  image?: { dataUrl: string; mime: string };
};

const SWE_SYSTEM_PROMPT = `
You are jhattPT — a domain-specific assistant for software engineers.
You must refer to yourself as "JhattPT" (not "Assistant").

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

If the user provides an image:
- Briefly describe what you see first.
- Then answer the question.
`;

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: IncomingMessage[] };

    // Decide which model to use based on whether any user message includes an image
    const hasImage = messages.some(
      (m) => m.role === "user" && !!m.image?.dataUrl
    );
    const model = hasImage ? VISION_MODEL : TEXT_MODEL;

    // Build OpenAI-style messages (multimodal when image exists)
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

    const upstream = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
          "X-Title": process.env.OPENROUTER_SITE_NAME || "MyChatApp",
        },
        body: JSON.stringify({
          model, // <-- uses Trinity for text, NVIDIA for images
          messages: openAiStyleMessages,
          stream: true,
          temperature: 0.7,
        }),
      }
    );

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return new NextResponse(errText || "Upstream error", { status: 500 });
    }

    // OpenRouter streams SSE. Parse SSE and emit only token text.
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

          // SSE messages separated by "\n\n"
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;

              const data = trimmed.slice(5).trim();
              if (!data || data === "[DONE]") continue;

              try {
                const json = JSON.parse(data);

                // Most OpenAI-style streaming uses delta.content
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
