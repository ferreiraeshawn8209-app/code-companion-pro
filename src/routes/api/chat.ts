import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayProvider, getLovableAiGatewayRunId } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `You are spok, an autonomous AI software engineering agent embedded in a coding-agent web app.

Mission: help the user ship production-ready software. You are AUTONOMOUS — don't just advise, act. You have real tools to inspect and modify the project's files.

How you work:
- Start by using your tools: list_files to see the workspace, read_file / search_files to understand code before changing it. Never guess file contents.
- When asked to build, fix, or improve something: make the edits yourself with write_file — create, update, and repair files directly. Then summarize what you changed and why.
- Work in loops: read → plan → edit → re-read to verify → report. Chain as many tool calls as the task needs.
- Actively hunt for bugs, security issues, dead code, and UX friction. Fix small obvious faults on sight (report them); ask before destructive actions (deleting files, large rewrites).
- Be creative in design — distinctive visual direction (color, type, layout, motion) over generic scaffolding. Reject default AI aesthetics unless requested.
- Prefer TypeScript, React, Tailwind, and semantic design tokens over raw hex colors.
- Never fabricate library APIs. If unsure of a file's current state, read it again.

Proactive advisory duty (always on):
- End EVERY substantive reply with a "## suggestions" section: 2-5 concrete, prioritized items tagged [fix], [perf], [security], [ux], or [feature], naming the files involved.
- Flag faults you notice even when unrelated to the current question. Say "no issues found" when an area is genuinely clean.

Keep replies scannable: short bullets, concrete next steps, what you changed, what you recommend next.`;

type ChatBody = {
  messages?: UIMessage[];
  model?: string;
  projectId?: string;
  projectContext?: { name?: string; description?: string; files?: Array<{ path: string }> };
};

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function makeUserClient(url: string, key: string, token: string) {
  return createClient<Database>(url, key, {
    global: {
      fetch: ((input, init) => {
        const headers = new Headers(
          typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
        );
        if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
        if (isNewSupabaseApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      }) as typeof fetch,
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function buildTools(supabase: ReturnType<typeof makeUserClient>, projectId: string | undefined, userId: string) {
  const needProject = () => {
    if (!projectId) throw new Error("no project open — ask the user to open a project first");
    return projectId;
  };
  const audit = async (action: string, target: string, metadata: Record<string, unknown>) => {
    await supabase.from("audit_log").insert({
      project_id: projectId ?? null,
      action,
      target,
      metadata,
      user_id: userId,
    } as never);
  };

  return {
    list_files: tool({
      description: "List every file path in the current project workspace.",
      inputSchema: z.object({}),
      execute: async () => {
        const pid = needProject();
        const { data, error } = await supabase
          .from("project_files")
          .select("path, language, updated_at")
          .eq("project_id", pid)
          .order("path")
          .limit(500);
        if (error) return { error: error.message };
        return { files: data ?? [], count: data?.length ?? 0 };
      },
    }),

    read_file: tool({
      description: "Read the full contents of a file in the project workspace.",
      inputSchema: z.object({ path: z.string().describe("exact file path, e.g. src/App.tsx") }),
      execute: async ({ path }) => {
        const pid = needProject();
        const { data, error } = await supabase
          .from("project_files")
          .select("path, content, language")
          .eq("project_id", pid)
          .eq("path", path)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: `file not found: ${path}` };
        return { path: data.path, language: data.language, content: data.content.slice(0, 60000) };
      },
    }),

    search_files: tool({
      description: "Full-text search across all project files. Returns matching paths with a short excerpt.",
      inputSchema: z.object({ query: z.string().describe("text to search for in file contents") }),
      execute: async ({ query }) => {
        const pid = needProject();
        const { data, error } = await supabase
          .from("project_files")
          .select("path, content")
          .eq("project_id", pid)
          .ilike("content", `%${query}%`)
          .limit(20);
        if (error) return { error: error.message };
        const matches = (data ?? []).map((f) => {
          const idx = f.content.toLowerCase().indexOf(query.toLowerCase());
          const start = Math.max(0, idx - 120);
          return {
            path: f.path,
            excerpt: f.content.slice(start, idx + 200),
          };
        });
        return { matches, count: matches.length };
      },
    }),

    write_file: tool({
      description:
        "Create or overwrite a file in the project workspace. Use for fixes, new features, refactors. Always re-read after writing to verify.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string().describe("the COMPLETE new file content"),
        language: z.string().nullable().describe("e.g. typescript, tsx, css, json"),
        reason: z.string().describe("one-line summary of why this change is being made"),
      }),
      execute: async ({ path, content, language, reason }) => {
        const pid = needProject();
        const { error } = await supabase.from("project_files").upsert(
          {
            project_id: pid,
            path,
            content,
            language: language ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "project_id,path" },
        );
        if (error) return { error: error.message };
        await audit("ai.write_file", path, { reason, bytes: content.length });
        return { ok: true, path, bytes: content.length, reason };
      },
    }),

    delete_file: tool({
      description: "Delete a file from the project workspace. Destructive — only use when the user asked or the file is clearly dead code.",
      inputSchema: z.object({
        path: z.string(),
        reason: z.string(),
      }),
      execute: async ({ path, reason }) => {
        const pid = needProject();
        const { error } = await supabase
          .from("project_files")
          .delete()
          .eq("project_id", pid)
          .eq("path", path);
        if (error) return { error: error.message };
        await audit("ai.delete_file", path, { reason });
        return { ok: true, path, reason };
      },
    }),

    make_mobile_ready: tool({
      description:
        "Convert the current web project into an Android + iOS (Capacitor) compatible app. Writes capacitor.config.ts, mobile npm scripts, @capacitor deps in package.json, setup-android.sh and ANDROID_STUDIO.md into the workspace. Use when the user asks to make the app Android/iOS compatible.",
      inputSchema: z.object({
        appId: z.string().describe("reverse-domain bundle id, e.g. app.spok.myproject"),
        appName: z.string().describe("display name shown under the launcher icon"),
        mode: z.enum(["bundled", "live"]).describe("bundled = offline store-ready build; live = hot-loads a published URL"),
        liveReloadUrl: z.string().nullable().describe("published https URL, required when mode is 'live', otherwise null"),
      }),
      execute: async ({ appId, appName, mode, liveReloadUrl }) => {
        const pid = needProject();
        const { buildMobileScaffoldFiles } = await import("@/lib/android-export.server");
        const { data: pkg } = await supabase
          .from("project_files")
          .select("content")
          .eq("project_id", pid)
          .eq("path", "package.json")
          .maybeSingle();
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", pid)
          .maybeSingle();

        const files = buildMobileScaffoldFiles(
          {
            appId,
            appName,
            projectName: project?.name ?? appName,
            liveReloadUrl: mode === "live" ? liveReloadUrl : null,
          },
          pkg?.content,
        );

        const now = new Date().toISOString();
        const { error } = await supabase.from("project_files").upsert(
          files.map((f) => ({ project_id: pid, path: f.path, content: f.content, language: f.language, updated_at: now })),
          { onConflict: "project_id,path" },
        );
        if (error) return { error: error.message };
        await audit("ai.make_mobile_ready", appId, { appName, mode, files: files.map((f) => f.path) });
        return {
          ok: true,
          appId,
          appName,
          mode,
          written: files.map((f) => f.path),
          next: "Call export_android_project to give the user a downloadable Android Studio project.",
        };
      },
    }),

    export_android_project: tool({
      description:
        "Package the workspace as a downloadable Android Studio (Capacitor) project zip and offer it to the user in chat. Run make_mobile_ready first if the project has no capacitor.config.ts.",
      inputSchema: z.object({
        appId: z.string(),
        appName: z.string(),
      }),
      execute: async ({ appId, appName }) => {
        const pid = needProject();
        const { count, error } = await supabase
          .from("project_files")
          .select("path", { count: "exact", head: true })
          .eq("project_id", pid);
        if (error) return { error: error.message };
        if (!count) return { error: "workspace is empty — import a repo first" };
        await audit("ai.export_android_project", appId, { appName, fileCount: count });
        return {
          ready: true,
          appId,
          appName,
          fileCount: count,
          download: "offered_in_chat",
          note: "A download button is shown to the user in chat. Unzip, run setup-android.sh, Android Studio opens the native app.",
        };
      },
    }),
  };
}


export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatBody;
        if (!Array.isArray(body.messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        // --- authenticate (agent tools mutate the workspace, so auth is required) ---
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!token || token.split(".").length !== 3 || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const supabase = makeUserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, token);
        const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
        if (claimsError || !claimsData?.claims?.sub) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = claimsData.claims.sub;

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
          if (body.projectId) contextBits.push(`Project id: ${body.projectId} (tools are already scoped to it)`);
          if (body.projectContext.files?.length) {
            const list = body.projectContext.files.slice(0, 100).map((f) => `- ${f.path}`).join("\n");
            contextBits.push(`\nProject files (use read_file for contents):\n${list}`);
          }
        }

        try {
          const result = streamText({
            model,
            system: contextBits.join("\n"),
            messages: await convertToModelMessages(body.messages),
            tools: buildTools(supabase, body.projectId, userId),
            stopWhen: stepCountIs(50),
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
