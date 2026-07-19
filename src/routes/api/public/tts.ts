import { createFileRoute } from "@tanstack/react-router";

/**
 * Text-to-speech passthrough. POST { text, voice? } → SSE stream of PCM chunks.
 */
export const Route = createFileRoute("/api/public/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { text, voice } = (await request.json()) as { text?: string; voice?: string };
        if (!text || typeof text !== "string") {
          return new Response("text is required", { status: 400 });
        }
        const trimmed = text.slice(0, 4000);

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: trimmed,
            voice: voice || "alloy",
            stream_format: "sse",
            response_format: "pcm",
          }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          return new Response(errText || `tts failed: ${res.status}`, { status: res.status });
        }

        return new Response(res.body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    },
  },
});
