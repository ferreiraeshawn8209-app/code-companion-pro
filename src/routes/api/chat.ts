import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayProvider, getLovableAiGatewayRunId } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `You are spok, an autonomous AI software engineering agent embedded in a coding-agent web app.

Mission: help the user ship production-ready software end to end — read the repo, write the code, commit it, open and merge pull requests, and deploy it. You are AUTONOMOUS: don't just advise, act. You have real tools.

How you work:
- Start by using your tools: list_files to see the workspace, read_file / search_files to understand code before changing it. Never guess file contents.
- When asked to build, fix, or improve something: make the edits yourself with write_file — create, update, and repair files directly. Then summarize what you changed and why.
- Work in loops: read → plan → edit → re-read to verify → ship → report. Chain as many tool calls as the task needs.
- Actively hunt for bugs, security issues, dead code, and UX friction. Fix small obvious faults on sight (report them); ask before destructive actions (deleting files, force pushes, production deploys the user didn't ask for).
- Be creative in design — distinctive visual direction (color, type, layout, motion) over generic scaffolding.
- Prefer TypeScript, React, Tailwind, and semantic design tokens over raw hex colors. Never fabricate library APIs.

Repo, git and shipping:
- github_list_repos + github_import_repo load a repository into the workspace. Do this yourself when the user names a repo — don't tell them to click a button.
- After making changes: github_commit to a working branch (create it implicitly by committing to a new branch name), then github_open_pr, then github_merge_pr when the user approves or explicitly asked you to merge.
- Commit straight to the default branch only when the user asked for that.
- vercel_deploy ships the workspace; default to target "preview" and use "production" only when asked. Poll vercel_deployment_status until it is READY or ERROR, and report the live URL.
- If a GitHub tool returns a 401 / "Bad credentials" error, stop and tell the user to reconnect GitHub in Settings → Connectors — no other tool can work around it.

Learning (long-term memory):
- You have persistent memory across sessions. remember_fact stores durable knowledge: the user's preferences, stack conventions, repo names, app ids, deploy targets, recurring mistakes and their fixes, decisions you agreed on.
- Save a memory whenever the user states a preference, corrects you, rejects an approach, or you discover something about the project worth reusing. Don't ask permission — just save it and mention it in one short line.
- recall_facts searches memory when you need context you weren't given. forget_fact removes memory that is now wrong.
- Never re-propose something stored as a rejected approach.

Mobile conversion:
- If the user asks to make the app Android/iOS compatible, run make_mobile_ready (sensible appId like app.spok.<project-slug>; default mode "bundled"), then export_android_project so a download button appears in chat.

Cost policy (hard rule — build everything the best way for FREE):
- Zero paid services unless the user explicitly approves a specific paid plan in chat. Never default to paid builders (Codemagic paid Linux builders, EAS paid tiers, Appflow), paid hosting, or paid APIs.
- Free stack you always prefer: Lovable Cloud (backend, auth, AI — already included), GitHub free (repo, PRs, GitHub Actions minutes are free for public repos — use Actions for CI and Android APK builds), Vercel hobby (deploys, previews, HTTPS), Capacitor (open source) for Android/iOS.
- For APK builds prefer the repo's GitHub Actions workflow (free) or local Android Studio; never suggest paid cloud builds first.
- If a task genuinely requires money, say exactly what costs, what it unlocks, and the free alternative — then stop and let the user decide.
- Optimize for low ongoing cost: static/bundled assets, caching, small images, minimal third-party dependencies.

Proactive advisory duty (always on):
- End EVERY substantive reply with a "## suggestions" section: 2-5 concrete, prioritized items tagged [fix], [perf], [security], [ux], or [feature], naming the files involved.
- Flag faults you notice even when unrelated to the current question. Say "no issues found" when an area is genuinely clean.

Keep replies scannable: short bullets, concrete next steps, what you changed, what you shipped, what you recommend next.`;


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

    /* ---------------- GitHub ---------------- */

    github_list_repos: tool({
      description: "List the GitHub repositories the connected account can access.",
      inputSchema: z.object({}),
      execute: async () => {
        const ops = await import("@/lib/agent-ops.server");
        try {
          return { repos: await ops.listRepos() };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    github_import_repo: tool({
      description:
        "Import a GitHub repository's text files into the current project workspace so you can read and edit them. Use when the user names a repo.",
      inputSchema: z.object({
        fullName: z.string().describe("owner/repo"),
        branch: z.string().nullable().describe("branch to import, or null for the default branch"),
      }),
      execute: async ({ fullName, branch }) => {
        const pid = needProject();
        const ops = await import("@/lib/agent-ops.server");
        try {
          return await ops.importRepo(supabase, pid, userId, fullName, branch);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    github_commit: tool({
      description:
        "Commit the workspace (or specific paths) to a GitHub branch. Creates the branch off the default branch if it does not exist. Use after making edits.",
      inputSchema: z.object({
        fullName: z.string().describe("owner/repo"),
        branch: z.string().describe("branch to commit to, e.g. spok/fix-auth"),
        message: z.string().describe("commit message"),
        paths: z.array(z.string()).nullable().describe("limit the commit to these workspace paths, or null for all files"),
      }),
      execute: async ({ fullName, branch, message, paths }) => {
        const pid = needProject();
        const ops = await import("@/lib/agent-ops.server");
        try {
          return await ops.commitWorkspace(supabase, pid, userId, fullName, branch, message, paths);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    github_open_pr: tool({
      description: "Open a pull request from a branch into the base branch.",
      inputSchema: z.object({
        fullName: z.string(),
        head: z.string().describe("branch containing the changes"),
        base: z.string().nullable().describe("target branch, or null for the default branch"),
        title: z.string(),
        body: z.string().describe("markdown description of what changed and why"),
      }),
      execute: async ({ fullName, head, base, title, body }) => {
        const ops = await import("@/lib/agent-ops.server");
        try {
          const pr = await ops.openPullRequest(fullName, head, title, body, base);
          await audit("ai.github_open_pr", `${fullName}#${pr.number}`, { title, head });
          return pr;
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    github_list_prs: tool({
      description: "List open pull requests on a repository.",
      inputSchema: z.object({ fullName: z.string() }),
      execute: async ({ fullName }) => {
        const ops = await import("@/lib/agent-ops.server");
        try {
          return { pulls: await ops.listPullRequests(fullName) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    github_merge_pr: tool({
      description:
        "Merge a pull request. Only do this when the user asked you to merge or already approved the change.",
      inputSchema: z.object({
        fullName: z.string(),
        number: z.number(),
        method: z.enum(["merge", "squash", "rebase"]),
      }),
      execute: async ({ fullName, number, method }) => {
        const ops = await import("@/lib/agent-ops.server");
        try {
          const res = await ops.mergePullRequest(fullName, number, method);
          await audit("ai.github_merge_pr", `${fullName}#${number}`, { method, merged: res.merged });
          return res;
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    /* ---------------- Deploy ---------------- */

    vercel_deploy: tool({
      description:
        "Deploy the current workspace to Vercel. Use target 'preview' unless the user asked for production. Requires a linked Vercel project.",
      inputSchema: z.object({ target: z.enum(["preview", "production"]) }),
      execute: async ({ target }) => {
        const pid = needProject();
        const ops = await import("@/lib/agent-ops.server");
        try {
          return await ops.deployWorkspace(supabase, pid, userId, target);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    vercel_deployment_status: tool({
      description: "Check whether a Vercel deployment is READY, BUILDING or ERROR. Poll after vercel_deploy.",
      inputSchema: z.object({ deploymentId: z.string() }),
      execute: async ({ deploymentId }) => {
        const ops = await import("@/lib/agent-ops.server");
        try {
          return await ops.deploymentStatus(deploymentId);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    /* ---------------- Learning ---------------- */

    remember_fact: tool({
      description:
        "Save durable knowledge to long-term memory: user preferences, conventions, repo names, decisions, rejected approaches, recurring fixes. Reusing the same key overwrites it.",
      inputSchema: z.object({
        key: z.string().describe("short stable slug, e.g. 'preferred-branch-prefix'"),
        value: z.string().describe("the fact, written so a future session can act on it"),
        kind: z.enum(["preference", "constraint", "convention", "fact", "fix"]),
        scope: z.enum(["project", "global"]).describe("project = this workspace only; global = all the user's projects"),
      }),
      execute: async ({ key, value, kind, scope }) => {
        const scopedProject = scope === "project" ? needProject() : null;
        const { error } = await supabase.from("agent_memory").upsert(
          {
            user_id: userId,
            project_id: scopedProject,
            key,
            value,
            kind,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: scopedProject ? "user_id,project_id,key" : "user_id,key" },
        );
        if (error) return { error: error.message };
        return { saved: true, key, kind, scope };
      },
    }),

    recall_facts: tool({
      description: "Search long-term memory for previously learned facts about this user or project.",
      inputSchema: z.object({ query: z.string().nullable().describe("text to match, or null for everything") }),
      execute: async ({ query }) => {
        let q = supabase
          .from("agent_memory")
          .select("key, value, kind, project_id, updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(50);
        if (query) q = q.or(`key.ilike.%${query}%,value.ilike.%${query}%`);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { memories: data ?? [], count: data?.length ?? 0 };
      },
    }),

    forget_fact: tool({
      description: "Delete a memory that is now wrong or obsolete.",
      inputSchema: z.object({ key: z.string() }),
      execute: async ({ key }) => {
        const { error } = await supabase
          .from("agent_memory")
          .delete()
          .eq("user_id", userId)
          .eq("key", key);
        if (error) return { error: error.message };
        return { forgotten: key };
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

        // --- long-term memory: everything global + everything for this project ---
        {
          let memQuery = supabase
            .from("agent_memory")
            .select("key, value, kind, project_id")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false })
            .limit(60);
          memQuery = body.projectId
            ? memQuery.or(`project_id.is.null,project_id.eq.${body.projectId}`)
            : memQuery.is("project_id", null);
          const { data: memories } = await memQuery;
          if (memories?.length) {
            const lines = memories
              .map((m) => `- [${m.kind}${m.project_id ? "" : "/global"}] ${m.key}: ${m.value}`)
              .join("\n");
            contextBits.push(
              `\nLearned memory (apply these automatically; never re-propose a rejected approach):\n${lines}`,
            );
          }
        }

        // --- repo currently linked to this project ---
        if (body.projectId) {
          const { data: proj } = await supabase
            .from("projects")
            .select("github_repo_full_name, vercel_project_name")
            .eq("id", body.projectId)
            .maybeSingle();
          if (proj?.github_repo_full_name) {
            contextBits.push(`\nLinked GitHub repo: ${proj.github_repo_full_name} (use it for commits and PRs).`);
          }
          if (proj?.vercel_project_name) {
            contextBits.push(`Linked Vercel project: ${proj.vercel_project_name}.`);
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
