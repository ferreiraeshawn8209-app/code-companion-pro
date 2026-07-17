import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Github, Rocket, Save, Terminal } from "lucide-react";
import { ChatPanel } from "@/components/workspace/ChatPanel";
import { FileExplorer, type WsFile } from "@/components/workspace/FileExplorer";
import { GithubImportDialog } from "@/components/workspace/GithubImportDialog";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import type { UIMessage } from "ai";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  component: ProjectWorkspace,
});

type Project = {
  id: string;
  name: string;
  description: string | null;
  github_repo_full_name: string | null;
  ai_model: string;
  ai_provider: string;
};

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

function ProjectWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<WsFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const lovableModels = AI_PROVIDERS[0].models;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: p, error } = await supabase
        .from("projects")
        .select("id,name,description,github_repo_full_name,ai_model,ai_provider")
        .eq("id", id)
        .maybeSingle();
      if (error || !p) {
        toast.error(error?.message ?? "project not found");
        navigate({ to: "/dashboard" });
        return;
      }
      setProject(p);

      const { data: fs } = await supabase
        .from("project_files")
        .select("id,path,language")
        .eq("project_id", id)
        .order("path");
      setFiles(fs ?? []);
      if (fs && fs.length > 0) setActivePath(fs[0].path);

      // load latest session + messages
      const { data: sess } = await supabase
        .from("ai_sessions")
        .select("id")
        .eq("project_id", id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sess) {
        setSessionId(sess.id);
        const { data: msgs } = await supabase
          .from("ai_messages")
          .select("id,role,parts,created_at")
          .eq("session_id", sess.id)
          .order("created_at");
        if (msgs) {
          setInitialMessages(
            msgs.map((m) => ({
              id: m.id,
              role: m.role as UIMessage["role"],
              parts: m.parts as UIMessage["parts"],
            })),
          );
        }
      }
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!activePath) {
      setBuffer("");
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("project_files")
        .select("content")
        .eq("project_id", id)
        .eq("path", activePath)
        .maybeSingle();
      setBuffer(data?.content ?? "");
      setDirty(false);
    })();
  }, [activePath, id]);

  const active = useMemo(() => files.find((f) => f.path === activePath), [files, activePath]);

  const createFile = async (path: string) => {
    if (files.some((f) => f.path === path)) {
      toast.error("file exists");
      return;
    }
    const lang = languageFromPath(path);
    const { data, error } = await supabase
      .from("project_files")
      .insert({ project_id: id, path, content: "", language: lang })
      .select("id,path,language")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "create failed");
      return;
    }
    setFiles((prev) => [...prev, data].sort((a, b) => a.path.localeCompare(b.path)));
    setActivePath(path);
    await supabase.from("audit_log").insert({
      project_id: id,
      action: "file.create",
      target: path,
      user_id: (await supabase.auth.getUser()).data.user?.id,
    });
  };

  const deleteFile = async (fileId: string, path: string) => {
    const { error } = await supabase.from("project_files").delete().eq("id", fileId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    if (activePath === path) setActivePath(null);
    toast.success(`deleted ${path}`);
    await supabase.from("audit_log").insert({
      project_id: id,
      action: "file.delete",
      target: path,
      user_id: (await supabase.auth.getUser()).data.user?.id,
    });
  };

  const save = async () => {
    if (!activePath) return;
    setSaving(true);
    const { error } = await supabase
      .from("project_files")
      .update({ content: buffer })
      .eq("project_id", id)
      .eq("path", activePath);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDirty(false);
    toast.success("saved");
  };

  const updateModel = async (model: string) => {
    if (!project) return;
    setProject({ ...project, ai_model: model });
    await supabase.from("projects").update({ ai_model: model }).eq("id", id);
  };

  if (loading || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center font-mono text-muted-foreground text-sm">
        $ loading workspace...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b border-border shrink-0">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="font-mono">
                <ArrowLeft className="h-4 w-4 mr-1" /> projects
              </Button>
            </Link>
            <div className="flex items-center gap-2 font-mono">
              <Terminal className="h-4 w-4 text-primary" />
              <span className="text-primary">{project.name}</span>
              {project.github_repo_full_name && (
                <Badge variant="outline" className="font-mono text-xs border-border">
                  <Github className="h-3 w-3 mr-1" /> {project.github_repo_full_name}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={project.ai_model} onValueChange={updateModel}>
              <SelectTrigger className="w-[220px] h-8 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lovableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <Tabs defaultValue="workspace" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 font-mono text-xs w-fit">
          <TabsTrigger value="workspace">workspace</TabsTrigger>
          <TabsTrigger value="deploy">deploy</TabsTrigger>
          <TabsTrigger value="audit">audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="workspace" className="flex-1 overflow-hidden mt-2 mx-4 mb-4">
          <div className="grid grid-cols-12 gap-3 h-full">
            {/* File explorer */}
            <div className="col-span-2 border border-border rounded-md bg-sidebar overflow-hidden">
              <FileExplorer
                files={files}
                activePath={activePath}
                onSelect={setActivePath}
                onCreate={createFile}
                onDelete={deleteFile}
              />
            </div>

            {/* Editor */}
            <div className="col-span-6 border border-border rounded-md bg-card overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                <div className="font-mono text-xs truncate">
                  {activePath ? (
                    <>
                      <span className="text-muted-foreground">~ /</span>
                      <span className="text-primary">{activePath}</span>
                      {dirty && <span className="text-destructive ml-2">●</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">// no file selected</span>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={save} disabled={!dirty || saving} className="font-mono h-6 text-xs">
                  <Save className="h-3 w-3 mr-1" />
                  {saving ? "..." : "save"}
                </Button>
              </div>
              <div className="flex-1">
                {activePath ? (
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language={active?.language || languageFromPath(activePath)}
                    value={buffer}
                    onChange={(v) => {
                      setBuffer(v ?? "");
                      setDirty(true);
                    }}
                    options={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 13,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center font-mono text-xs text-muted-foreground">
                    select or create a file to start editing
                  </div>
                )}
              </div>
            </div>

            {/* Chat */}
            <div className="col-span-4 border border-border rounded-md bg-card overflow-hidden flex flex-col">
              <div className="px-3 py-1.5 border-b border-border font-mono text-xs text-primary">
                $ agent
              </div>
              <div className="flex-1 overflow-hidden">
                <ChatPanel
                  projectId={id}
                  projectName={project.name}
                  projectDescription={project.description}
                  model={project.ai_model}
                  files={files.map((f) => ({ path: f.path }))}
                  sessionId={sessionId}
                  onSessionCreated={setSessionId}
                  initialMessages={initialMessages}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="deploy" className="mx-4 mb-4 flex-1 overflow-auto">
          <div className="rounded-md border border-dashed border-border p-16 text-center">
            <Rocket className="h-8 w-8 text-primary mx-auto" />
            <div className="mt-4 font-mono text-sm">deployment provider</div>
            <p className="mt-2 text-xs text-muted-foreground max-w-md mx-auto">
              Vercel, Cloudflare, and self-host targets arrive in Phase 3.
              You'll deploy production/preview builds with log streaming and AI-suggested fixes on failure.
            </p>
            <Button disabled className="mt-4 font-mono">$ connect vercel — soon</Button>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mx-4 mb-4 flex-1 overflow-auto">
          <AuditFeed projectId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AuditFeed({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Array<{ id: string; action: string; target: string | null; created_at: string; metadata: unknown }>>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("id,action,target,created_at,metadata")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(200);
      setRows(data ?? []);
    })();
  }, [projectId]);
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="font-mono text-xs text-primary p-3 border-b border-border">$ tail -f audit.log</div>
      <div className="divide-y divide-border max-h-full overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6 font-mono text-xs text-muted-foreground">// nothing logged yet</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="p-3 flex items-center justify-between font-mono text-xs">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                <span className="text-primary">{r.action}</span>
                {r.target && <span className="text-muted-foreground truncate max-w-md">{r.target}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
