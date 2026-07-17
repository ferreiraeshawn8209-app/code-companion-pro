import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/github";

function gh(path: string, init?: RequestInit) {
  const lk = process.env.LOVABLE_API_KEY;
  const gk = process.env.GITHUB_API_KEY;
  if (!lk || !gk) throw new Error("GitHub connector not configured");
  return fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lk}`,
      "X-Connection-Api-Key": gk,
      ...(init?.headers ?? {}),
    },
  });
}

export type GhRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  updated_at: string;
};

export const listGithubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<GhRepo[]> => {
    const res = await gh("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub list repos failed [${res.status}]: ${body}`);
    }
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    return raw.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      full_name: r.full_name as string,
      private: r.private as boolean,
      default_branch: (r.default_branch as string) ?? "main",
      description: (r.description as string | null) ?? null,
      updated_at: r.updated_at as string,
    }));
  });

function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", rb: "ruby",
    json: "json", md: "markdown", css: "css", html: "html", sql: "sql",
    yaml: "yaml", yml: "yaml", sh: "shell", toml: "ini",
  };
  return map[ext ?? ""] ?? "plaintext";
}

const TEXT_EXT = new Set([
  "ts","tsx","js","jsx","mjs","cjs","json","md","mdx","css","scss","html",
  "yml","yaml","toml","txt","sh","env","gitignore","py","rs","go","java",
  "rb","sql","xml","svg","vue","svelte","astro","php","c","h","cpp","hpp",
]);
const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 400;

export const importGithubRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { projectId: string; fullName: string; branch?: string }) => input,
  )
  .handler(async ({ data, context }) => {
    const { projectId, fullName } = data;
    const { supabase, userId } = context;

    // Verify user owns the project (RLS also enforces this)
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr || !project) throw new Error("Project not found");

    // Get repo meta for default branch
    const repoRes = await gh(`/repos/${fullName}`);
    if (!repoRes.ok) {
      const body = await repoRes.text();
      throw new Error(`GitHub repo fetch failed [${repoRes.status}]: ${body}`);
    }
    const repo = (await repoRes.json()) as { default_branch: string };
    const branch = data.branch ?? repo.default_branch;

    // Get recursive tree
    const treeRes = await gh(`/repos/${fullName}/git/trees/${branch}?recursive=1`);
    if (!treeRes.ok) {
      const body = await treeRes.text();
      throw new Error(`GitHub tree fetch failed [${treeRes.status}]: ${body}`);
    }
    const tree = (await treeRes.json()) as {
      tree: Array<{ path: string; type: string; size?: number; sha: string }>;
      truncated: boolean;
    };

    const blobs = tree.tree
      .filter((n) => n.type === "blob")
      .filter((n) => {
        const ext = n.path.split(".").pop()?.toLowerCase() ?? "";
        return TEXT_EXT.has(ext) && (n.size ?? 0) <= MAX_FILE_BYTES;
      })
      .slice(0, MAX_FILES);

    let imported = 0;
    for (const node of blobs) {
      const blobRes = await gh(`/repos/${fullName}/git/blobs/${node.sha}`);
      if (!blobRes.ok) continue;
      const blob = (await blobRes.json()) as { content: string; encoding: string };
      if (blob.encoding !== "base64") continue;
      const content = Buffer.from(blob.content, "base64").toString("utf-8");
      const language = languageFromPath(node.path);
      const { error } = await supabase
        .from("project_files")
        .upsert(
          { project_id: projectId, path: node.path, content, language },
          { onConflict: "project_id,path" },
        );
      if (!error) imported++;
    }

    await supabase
      .from("projects")
      .update({ github_repo_full_name: fullName })
      .eq("id", projectId);

    await supabase.from("audit_log").insert({
      project_id: projectId,
      user_id: userId,
      action: "github.import",
      target: fullName,
      metadata: { branch, imported, truncated: tree.truncated },
    });

    return { imported, truncated: tree.truncated, branch };
  });
