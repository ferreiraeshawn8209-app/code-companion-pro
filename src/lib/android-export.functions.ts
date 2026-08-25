import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const exportAndroidProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        appId: z.string().min(3),
        appName: z.string().min(1),
        liveReloadUrl: z.string().url().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { buildAndroidExportZip, toBase64 } = await import("./android-export.server");
    const supabase = context.supabase;

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id,name,owner_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr || !project) throw new Error("project not found");
    if (project.owner_id !== context.userId) throw new Error("forbidden");

    const { data: files, error: fErr } = await supabase
      .from("project_files")
      .select("path,content")
      .eq("project_id", data.projectId)
      .order("path");
    if (fErr) throw new Error(fErr.message);
    if (!files || files.length === 0) {
      throw new Error("no files in this project — import a repo first");
    }

    const zip = buildAndroidExportZip(files as Array<{ path: string; content: string }>, {
      appId: data.appId,
      appName: data.appName,
      projectName: project.name,
      liveReloadUrl: data.liveReloadUrl ?? null,
    });

    return {
      filename: `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-android.zip`,
      fileCount: files.length,
      base64: toBase64(zip),
    };
  });
