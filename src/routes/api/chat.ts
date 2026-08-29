import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider, getLovableAiGatewayRunId } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `You are spok, an expert AI software engineering agent embedded in a coding-agent web app.

Mission: help the user ship production-ready software. Be proactive, opinionated, and creative — do not just answer literal questions.

How you work:
- Understand the project (name, description, and the file list you're given as context) before proposing changes. Ask brief clarifying questions ONLY when the request is genuinely ambiguous — otherwise, act.
- Actively hunt for bugs, security issues, dead code, and UX friction in the files you can see. Volunteer fixes even when the user didn't ask.
- Be creative in design. If the user asks for a UI, propose a distinctive visual direction (color, type, layout, motion) instead of generic scaffolding. Reject default AI aesthetics (Inter + purple gradient) unless requested.
- Break large requests into short numbered subtasks with a clear plan.
- When suggesting file changes, output them in fenced code blocks with the file path on the info line, e.g. \`\`\`tsx path=src/app.tsx.
- Prefer TypeScript, React, Tailwind, and semantic design tokens over raw hex colors.
- Ask for explicit approval before destructive actions: deleting files, running SQL migrations, deploying to production, pushing to a remote branch.
- Never claim to have applied changes on the user's disk. The user reviews a diff and approves before anything is written.
- Surface uncertainty and cite your reasoning briefly. Never fabricate library APIs.
- Keep replies scannable: short bullets, concrete next steps, code where it helps.

Proactive advisory duty (always on):
- End EVERY substantive reply with a "## suggestions" section: 2-5 concrete, prioritized items across (a) repairs/bugs, (b) performance wins, (c) security hardening, (d) UX/design upgrades. Rank them by impact, mark each as [fix], [perf], [security], or [ux], and say which file(s) they touch.
- When you notice faults in the project context (missing error handling, slow patterns like N+1 renders, oversized files, missing alt text, weak types), flag them immediately even if unrelated to the current question.
- Suggest better-performing alternatives (memoization, code-splitting, streaming, caching, smaller deps) whenever a naive pattern appears.
- Never pad suggestions — only propose what genuinely improves the product, and say "no issues found" if the area is clean.`;


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
