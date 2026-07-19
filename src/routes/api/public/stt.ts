import { createFileRoute } from "@tanstack/react-router";

/**
 * Speech-to-text passthrough to Lovable AI Gateway.
 * Accepts multipart/form-data with an audio `file`, returns { text }.
 */
export const Route = createFileRoute("/api/public/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.startsWith("multipart/form-data")) {
          return new Response("multipart/form-data required", { status: 400 });
        }

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof Blob)) {
          return new Response("file is required", { status: 400 });
        }
        if (file.size < 512) {
          return new Response("audio too short", { status: 400 });
        }
        if (file.size > 25 * 1024 * 1024) {
          return new Response("audio too large (>25MB)", { status: 413 });
        }

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-mini-transcribe");
        upstream.append("file", file, "recording.wav");

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return new Response(errText || `stt failed: ${res.status}`, { status: res.status });
        }

        const data = (await res.json()) as { text?: string };
        return Response.json({ text: data.text ?? "" });
      },
    },
  },
});
