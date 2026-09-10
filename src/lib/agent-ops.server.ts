/**
 * Server-only operations the autonomous agent can perform:
 * GitHub (read/import/commit/branch/PR/merge) and Vercel (deploy).
 *
 * These are plain functions — the chat route wraps them as AI SDK tools and is
 * responsible for authenticating the caller and passing a user-scoped Supabase
 * client (so RLS still applies to every workspace read/write).
 */

const GITHUB_GATEWAY = "https://connector-gateway.lovable.dev/github";
const VERCEL_API = "https://api.vercel.com";

type Json = Record<string, unknown>;

export async function gh<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
  const lk = process.env.LOVABLE_API_KEY;
  const gk = process.env.GITHUB_API_KEY;
  if (!lk || !gk) throw new Error("GitHub connector is not configured for this project");
  const res = await fetch(`${GITHUB_GATEWAY}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${lk}`,
      "X-Connection-Api-Key": gk,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "GitHub credentials are expired or invalid (401 Bad credentials). Tell the user to reconnect GitHub in Settings → Connectors before retrying.",
      );
    }
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 600)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function vercel<T = Json>(path: string, init: RequestInit = {}, teamId?: string): Promise<T> {
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
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${text.slice(0, 600)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/* ------------------------------------------------------------------ *
 * GitHub read + import
 * ------------------------------------------------------------------ */

const TEXT_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "css", "scss", "html",
  "yml", "yaml", "toml", "txt", "sh", "env", "gitignore", "py", "rs", "go", "java",
  "rb", "sql", "xml", "svg", "vue", "svelte", "astro", "php", "c", "h", "cpp", "hpp",
]);
const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 400;

const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", rb: "ruby",
  json: "json", md: "markdown", css: "css", html: "html", sql: "sql",
  yaml: "yaml", yml: "yaml", sh: "shell", toml: "ini",
};
export function languageFromPath(path: string): string {
  return LANG[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
}

export async function listRepos() {
  const raw = await gh<Array<Json>>(
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
  );
  return raw.map((r) => ({
    full_name: r.full_name as string,
    private: r.private as boolean,
    default_branch: (r.default_branch as string) ?? "main",
    description: (r.description as string | null) ?? null,
    updated_at: r.updated_at as string,
  }));
}

/** Import a repo's text files into the project workspace. */
export async function importRepo(
  supabase: any,
  projectId: string,
  userId: string,
  fullName: string,
  branchInput?: string | null,
) {
  const repo = await gh<{ default_branch: string }>(`/repos/${fullName}`);
  const branch = branchInput || repo.default_branch;

  const tree = await gh<{
    tree: Array<{ path: string; type: string; size?: number; sha: string }>;
    truncated: boolean;
  }>(`/repos/${fullName}/git/trees/${branch}?recursive=1`);

  const blobs = tree.tree
    .filter((n) => n.type === "blob")
    .filter((n) => TEXT_EXT.has(n.path.split(".").pop()?.toLowerCase() ?? "") && (n.size ?? 0) <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES);

  const now = new Date().toISOString();
  let imported = 0;
  const batch: Array<Json> = [];
  for (const node of blobs) {
    const blob = await gh<{ content: string; encoding: string }>(
      `/repos/${fullName}/git/blobs/${node.sha}`,
    );
    if (blob.encoding !== "base64") continue;
    batch.push({
      project_id: projectId,
      path: node.path,
      content: Buffer.from(blob.content, "base64").toString("utf-8"),
      language: languageFromPath(node.path),
      updated_at: now,
    });
    imported++;
    if (batch.length >= 50) {
      await supabase.from("project_files").upsert(batch.splice(0), { onConflict: "project_id,path" });
    }
  }
  if (batch.length) {
    await supabase.from("project_files").upsert(batch, { onConflict: "project_id,path" });
  }

  await supabase.from("projects").update({ github_repo_full_name: fullName }).eq("id", projectId);
  await supabase.from("audit_log").insert({
    project_id: projectId,
    user_id: userId,
    action: "ai.github_import",
    target: fullName,
    metadata: { branch, imported, truncated: tree.truncated },
  });

  return { imported, branch, truncated: tree.truncated };
}

/* ------------------------------------------------------------------ *
 * GitHub write: branch, commit, PR, merge
 * ------------------------------------------------------------------ */

export async function createBranch(fullName: string, branch: string, fromBranch?: string | null) {
  const repo = await gh<{ default_branch: string }>(`/repos/${fullName}`);
  const base = fromBranch || repo.default_branch;
  const ref = await gh<{ object: { sha: string } }>(`/repos/${fullName}/git/ref/heads/${base}`);
  await gh(`/repos/${fullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }),
  });
  return { branch, base, sha: ref.object.sha };
}

/**
 * Commit the whole workspace (or a subset of paths) to a branch using the Git
 * Data API: blobs -> tree -> commit -> ref update. Creates the branch if needed.
 */
export async function commitWorkspace(
  supabase: any,
  projectId: string,
  userId: string,
  fullName: string,
  branch: string,
  message: string,
  onlyPaths?: string[] | null,
) {
  let query = supabase.from("project_files").select("path, content").eq("project_id", projectId);
  if (onlyPaths?.length) query = query.in("path", onlyPaths);
  const { data: files, error } = await query;
  if (error) throw new Error(error.message);
  if (!files?.length) throw new Error("no workspace files to commit");

  const repo = await gh<{ default_branch: string }>(`/repos/${fullName}`);

  let headSha: string | null = null;
  try {
    const ref = await gh<{ object: { sha: string } }>(`/repos/${fullName}/git/ref/heads/${branch}`);
    headSha = ref.object.sha;
  } catch {
    const baseRef = await gh<{ object: { sha: string } }>(
      `/repos/${fullName}/git/ref/heads/${repo.default_branch}`,
    );
    await gh(`/repos/${fullName}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
    headSha = baseRef.object.sha;
  }

  const baseCommit = await gh<{ tree: { sha: string } }>(`/repos/${fullName}/git/commits/${headSha}`);

  const treeItems: Array<Json> = [];
  for (const f of files as Array<{ path: string; content: string | null }>) {
    const blob = await gh<{ sha: string }>(`/repos/${fullName}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({
        content: Buffer.from(f.content ?? "", "utf-8").toString("base64"),
        encoding: "base64",
      }),
    });
    treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const tree = await gh<{ sha: string }>(`/repos/${fullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
  });

  const commit = await gh<{ sha: string; html_url: string }>(`/repos/${fullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });

  await gh(`/repos/${fullName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  await supabase.from("audit_log").insert({
    project_id: projectId,
    user_id: userId,
    action: "ai.github_commit",
    target: `${fullName}@${branch}`,
    metadata: { message, files: treeItems.length, sha: commit.sha },
  });

  return { sha: commit.sha, branch, files: treeItems.length, url: commit.html_url };
}

export async function openPullRequest(
  fullName: string,
  head: string,
  title: string,
  body: string,
  baseInput?: string | null,
) {
  const repo = await gh<{ default_branch: string }>(`/repos/${fullName}`);
  const pr = await gh<{ number: number; html_url: string; mergeable_state?: string }>(
    `/repos/${fullName}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({ title, head, base: baseInput || repo.default_branch, body }),
    },
  );
  return { number: pr.number, url: pr.html_url, base: baseInput || repo.default_branch };
}

export async function mergePullRequest(
  fullName: string,
  number: number,
  method: "merge" | "squash" | "rebase",
) {
  const res = await gh<{ merged: boolean; message: string; sha?: string }>(
    `/repos/${fullName}/pulls/${number}/merge`,
    { method: "PUT", body: JSON.stringify({ merge_method: method }) },
  );
  return { merged: res.merged, message: res.message, sha: res.sha ?? null, number };
}

export async function listPullRequests(fullName: string) {
  const prs = await gh<Array<Json>>(`/repos/${fullName}/pulls?state=open&per_page=30`);
  return prs.map((p) => ({
    number: p.number as number,
    title: p.title as string,
    head: (p.head as Json).ref as string,
    base: (p.base as Json).ref as string,
    url: p.html_url as string,
  }));
}

/* ------------------------------------------------------------------ *
 * Vercel deploy
 * ------------------------------------------------------------------ */

export async function deployWorkspace(
  supabase: any,
  projectId: string,
  userId: string,
  target: "production" | "preview",
) {
  const { data: proj } = await supabase
    .from("projects")
    .select("name, vercel_project_id, vercel_project_name")
    .eq("id", projectId)
    .maybeSingle();
  if (!proj?.vercel_project_name) {
    throw new Error("no Vercel project linked — the user must link one in the Deploy panel first");
  }

  const { data: files, error } = await supabase
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  if (!files?.length) throw new Error("no files to deploy");

  const deployment = await vercel<{ id: string; url: string; readyState: string }>("/v13/deployments", {
    method: "POST",
    body: JSON.stringify({
      name: proj.vercel_project_name,
      project: proj.vercel_project_name,
      target,
      files: (files as Array<{ path: string; content: string | null }>).map((f) => ({
        file: f.path,
        data: f.content ?? "",
        encoding: "utf-8",
      })),
      projectSettings: { framework: "vite" },
    }),
  });

  await supabase.from("vercel_deployments").insert({
    project_id: projectId,
    user_id: userId,
    vercel_project_id: proj.vercel_project_id,
    vercel_project_name: proj.vercel_project_name,
    deployment_id: deployment.id,
    deployment_url: deployment.url,
    target,
    state: deployment.readyState || "QUEUED",
  });

  await supabase.from("audit_log").insert({
    project_id: projectId,
    user_id: userId,
    action: "ai.vercel_deploy",
    target: `${proj.name} → ${deployment.url}`,
    metadata: { deployment_id: deployment.id, target },
  });

  return { deploymentId: deployment.id, url: `https://${deployment.url}`, state: deployment.readyState, target };
}

export async function deploymentStatus(deploymentId: string) {
  const d = await vercel<{ readyState: string; url: string; errorMessage?: string }>(
    `/v13/deployments/${deploymentId}`,
  );
  return { state: d.readyState, url: `https://${d.url}`, error: d.errorMessage ?? null };
}
