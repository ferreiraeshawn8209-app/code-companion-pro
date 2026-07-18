/**
 * Vercel deploy pipeline.
 *
 * All calls use the workspace-wide VERCEL_TOKEN secret. Each user must be a
 * project owner to trigger deploys — enforced by requireSupabaseAuth + an
 * ownership check on public.projects.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const VERCEL_API = "https://api.vercel.com";

async function vercel<T = unknown>(
  path: string,
  init: RequestInit = {},
  teamId?: string,
): Promise<T> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN is not configured");
  const url = new URL(`${VERCEL_API}${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vercel ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function assertOwner(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, owner_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) throw new Error("project not found");
  if (data.owner_id !== userId) throw new Error("forbidden");
  return data as { id: string; owner_id: string; name: string };
}

/** Confirm token works + return user/team info. */
export const vercelWhoami = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const user = await vercel<{ user: { username: string; email: string } }>(
        "/v2/user",
      );
      const teams = await vercel<{ teams: Array<{ id: string; slug: string; name: string }> }>(
        "/v2/teams",
      );
      return {
        ok: true as const,
        username: user.user.username,
        email: user.user.email,
        teams: teams.teams ?? [],
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** List Vercel projects (optionally scoped to a team). */
export const listVercelProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId?: string }) =>
    z.object({ teamId: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const r = await vercel<{ projects: Array<{ id: string; name: string; framework: string | null }> }>(
      "/v9/projects?limit=100",
      {},
      data.teamId,
    );
    return r.projects ?? [];
  });

/** Create a Vercel project. */
export const createVercelProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; framework?: string; teamId?: string }) =>
    z
      .object({
        name: z.string().min(1).max(100),
        framework: z.string().optional(),
        teamId: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const body = JSON.stringify({
      name: data.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      framework: data.framework ?? "vite",
    });
    return await vercel<{ id: string; name: string }>(
      "/v11/projects",
      { method: "POST", body },
      data.teamId,
    );
  });

/** Link a Vercel project to a Codex Green project. */
export const linkVercelProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; vercelProjectId: string; vercelProjectName: string }) =>
    z
      .object({
        projectId: z.string().uuid(),
        vercelProjectId: z.string(),
        vercelProjectName: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId, data.projectId);
    const { error } = await context.supabase
      .from("projects")
      .update({
        vercel_project_id: data.vercelProjectId,
        vercel_project_name: data.vercelProjectName,
      })
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      project_id: data.projectId,
      user_id: context.userId,
      action: "vercel.link",
      target: data.vercelProjectName,
    });
    return { ok: true };
  });

/**
 * Trigger a Vercel deployment from the current project_files.
 *
 * Uses the v13/deployments inline `files` upload path — no git required.
 */
export const deployToVercel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; target?: "production" | "preview"; teamId?: string }) =>
    z
      .object({
        projectId: z.string().uuid(),
        target: z.enum(["production", "preview"]).optional(),
        teamId: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const proj = await assertOwner(context.supabase, context.userId, data.projectId);

    const { data: pFull } = await context.supabase
      .from("projects")
      .select("vercel_project_id, vercel_project_name")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!pFull?.vercel_project_name) {
      throw new Error("no vercel project linked — link one first");
    }

    const { data: files, error: fErr } = await context.supabase
      .from("project_files")
      .select("path, content")
      .eq("project_id", data.projectId);
    if (fErr) throw new Error(fErr.message);
    if (!files || files.length === 0) throw new Error("no files to deploy");

    const inlineFiles = files.map((f: { path: string; content: string | null }) => ({
      file: f.path,
      data: f.content ?? "",
      encoding: "utf-8" as const,
    }));

    const deployment = await vercel<{
      id: string;
      url: string;
      readyState: string;
    }>(
      "/v13/deployments",
      {
        method: "POST",
        body: JSON.stringify({
          name: pFull.vercel_project_name,
          project: pFull.vercel_project_name,
          target: data.target ?? "preview",
          files: inlineFiles,
          projectSettings: { framework: "vite" },
        }),
      },
      data.teamId,
    );

    const { data: row } = await context.supabase
      .from("vercel_deployments")
      .insert({
        project_id: data.projectId,
        user_id: context.userId,
        vercel_project_id: pFull.vercel_project_id,
        vercel_project_name: pFull.vercel_project_name,
        deployment_id: deployment.id,
        deployment_url: deployment.url,
        target: data.target ?? "preview",
        state: deployment.readyState || "QUEUED",
      })
      .select("id")
      .single();

    await context.supabase.from("audit_log").insert({
      project_id: data.projectId,
      user_id: context.userId,
      action: "vercel.deploy",
      target: `${proj.name} → ${deployment.url}`,
      metadata: { deployment_id: deployment.id, target: data.target ?? "preview" },
    });

    return {
      rowId: row?.id,
      deploymentId: deployment.id,
      url: deployment.url,
      state: deployment.readyState,
    };
  });

/** Poll a deployment's status + refresh the DB row. */
export const getDeploymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deploymentId: string; rowId: string; teamId?: string }) =>
    z
      .object({
        deploymentId: z.string(),
        rowId: z.string().uuid(),
        teamId: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const d = await vercel<{
      id: string;
      url: string;
      readyState: string;
      target: string;
      createdAt: number;
    }>(`/v13/deployments/${data.deploymentId}`, {}, data.teamId);

    await context.supabase
      .from("vercel_deployments")
      .update({ state: d.readyState })
      .eq("id", data.rowId);

    return { state: d.readyState, url: d.url };
  });

/** Fetch recent build events for a deployment. */
export const getDeploymentEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deploymentId: string; teamId?: string }) =>
    z.object({ deploymentId: z.string(), teamId: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const events = await vercel<
      Array<{ type: string; created: number; text?: string; payload?: { text?: string } }>
    >(`/v3/deployments/${data.deploymentId}/events?limit=200`, {}, data.teamId);
    return events.map((e) => ({
      type: e.type,
      created: e.created,
      text: e.text ?? e.payload?.text ?? "",
    }));
  });

/** List recent deployments for a Codex Green project. */
export const listProjectDeployments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("vercel_deployments")
      .select("id, deployment_id, deployment_url, target, state, created_at")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
