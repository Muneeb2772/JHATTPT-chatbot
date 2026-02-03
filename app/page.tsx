"use client";


import rehypeHighlight from "rehype-highlight";
import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: { dataUrl: string; mime: string };
};

function uid() {
  return Math.random().toString(36).slice(2);
}

function MessageRow({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";

  return (
    <div className="w-full border-b border-[#2B2B2B]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* Optional label */}
        <div className="text-[11px] uppercase tracking-wide text-[#8A8A8A] mb-2">
          {isUser ? "You" : "Assistant"}
        </div>

        {/* User can have a light box; assistant is plain like ChatGPT */}
        <div className={isUser ? "bg-[#2A2A2A] border border-[#3A3A3A] rounded-2xl p-4" : ""}>
          {m.image?.dataUrl && (
            <img
              src={m.image.dataUrl}
              alt="uploaded"
              className="mb-4 rounded-xl max-h-96 object-contain border border-[#3A3A3A]"
            />
          )}

          <ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight]}
  components={{
pre: ({ children }) => (
  <div className="my-4 overflow-hidden rounded-xl border border-[#3A3A3A] bg-[#1B1B1B]">
    <div className="px-4 py-2 text-xs text-[#B5B5B5] border-b border-[#3A3A3A] bg-[#202020]">
      terminal
    </div>
    <pre className="overflow-x-auto">
      {children}
    </pre>
  </div>
),

    code: ({ className, children, ...props }) => {
      const isBlock =
        typeof className === "string" && className.includes("language-");

      if (isBlock) {
        return (
          <code
            // IMPORTANT: don't set text color here; highlight.js theme will do it
            className={`hljs block p-4 text-sm leading-relaxed ${className}`}
            {...props}
          >
            {children}
          </code>
        );
      }

      // Inline code
      return (
        <code
          className="px-1 py-0.5 rounded bg-[#1E1E1E] border border-[#3A3A3A] text-[#EDEDED]"
          {...props}
        >
          {children}
        </code>
      );
    },
  }}
>
  {m.content || ""}
</ReactMarkdown>


        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; mime: string } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const canSend = useMemo(
    () => !isStreaming && (!!input.trim() || !!image),
    [input, image, isStreaming]
  );

  async function onPickImage(file: File) {
    if (!file.type.startsWith("image/")) return;

    const maxMB = 4;
    if (file.size > maxMB * 1024 * 1024) {
      alert(`Image too large. Max ${maxMB}MB.`);
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });

    setImage({ dataUrl, mime: file.type });
  }

  async function send() {
    if (!canSend) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: input.trim(),
      image: image ?? undefined,
    };

    const assistantMsg: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setImage(null);
    setIsStreaming(true);

    try {
      const payloadMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
        image: m.image,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunk = decoder.decode(value || new Uint8Array(), { stream: !done });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m
          )
        );
      }
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${e?.message ?? "Unknown error"}` }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-[#212121] text-[#EDEDED]">
      <header className="border-b border-[#2B2B2B]">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <h1 className="text-base font-semibold tracking-tight">BhattGPT</h1>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-3xl px-4 py-8 text-[#B5B5B5]">
            Send a message (and optionally an image).
          </div>
        ) : (
          messages.map((m) => <MessageRow key={m.id} m={m} />)
        )}
      </section>

      <footer className="border-t border-[#2B2B2B] bg-[#212121]">
        <div className="mx-auto max-w-3xl px-4 py-4">
          {image && (
            <div className="mb-3 flex items-center gap-3">
              <img
                src={image.dataUrl}
                alt="preview"
                className="h-16 w-16 rounded-xl object-cover border border-[#3A3A3A]"
              />
              <button
                className="text-sm text-[#B5B5B5] hover:text-white"
                onClick={() => setImage(null)}
              >
                Remove image
              </button>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <input
              className="hidden"
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickImage(f);
                e.currentTarget.value = "";
              }}
            />

            <button
              className="px-3 py-3 rounded-2xl bg-[#2A2A2A] border border-[#3A3A3A] hover:bg-[#333333] transition disabled:opacity-50"
              onClick={() => fileRef.current?.click()}
              disabled={isStreaming}
            >
              + Image
            </button>

            <textarea
              className="flex-1 min-h-[48px] max-h-40 resize-none px-4 py-3 rounded-2xl
                         bg-[#2A2A2A] border border-[#3A3A3A]
                         text-[#EDEDED] placeholder:text-[#8A8A8A]
                         outline-none focus:ring-2 focus:ring-white/10"
              placeholder="Message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={isStreaming}
            />

            <button
              className="px-4 py-3 rounded-2xl bg-[#EDEDED] text-[#212121] font-medium hover:bg-white transition disabled:opacity-50"
              onClick={send}
              disabled={!canSend}
            >
              Send
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
