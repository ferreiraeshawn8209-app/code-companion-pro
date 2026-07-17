import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider, getLovableAiGatewayRunId } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `You are Codex Green, an expert AI software engineering agent embedded in a coding-agent web app.

Principles:
- Understand the user's project before proposing changes. Ask brief clarifying questions when the request is ambiguous.
- Break large requests into subtasks. Explain your plan in short steps.
- When suggesting file changes, output them in fenced code blocks with the file path on the info line, e.g. \`\`\`tsx path=src/app.tsx.
- Never claim to have applied changes on the user's disk. The user reviews a diff and approves before anything is written.
- Ask for explicit approval before destructive actions: deleting files, running SQL migrations, deploying, or pushing to a remote branch.
- Explain reasoning concisely. Prefer bullet points over prose.
- If the user asks for code, produce production-ready TypeScript / React / SQL. Include imports.
- Surface uncertainty; never fabricate library APIs.`;

type ChatBody = {
  messages?: UIMessage[];
  model?: string;
  projectContext?: { name?: string; description?: string; files?: Array<{ path: string }> };
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatBody;
        if (!Array.isArray(body.messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayProvider(key, initialRunId);
        const modelId = body.model || "google/gemini-3.5-flash";
        const model = gateway(modelId);

        const contextBits: string[] = [SYSTEM_PROMPT];
        if (body.projectContext?.name) {
          contextBits.push(`\n\nCurrent project: ${body.projectContext.name}`);
          if (body.projectContext.description) contextBits.push(`Description: ${body.projectContext.description}`);
          if (body.projectContext.files?.length) {
            const list = body.projectContext.files.slice(0, 100).map((f) => `- ${f.path}`).join("\n");
            contextBits.push(`\nProject files:\n${list}`);
          }
        }

        try {
          const result = streamText({
            model,
            system: contextBits.join("\n"),
            messages: await convertToModelMessages(body.messages),
          });
          return result.toUIMessageStreamResponse({ originalMessages: body.messages });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
