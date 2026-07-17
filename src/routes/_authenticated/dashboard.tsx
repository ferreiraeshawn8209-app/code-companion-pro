import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogOut, Plus, Terminal, FolderGit2 } from "lucide-react";

type Project = {
  id: string;
  name: string;
  description: string | null;
  github_repo_full_name: string | null;
  ai_model: string;
  updated_at: string;
};

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    setEmail(u.user?.email ?? null);
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,description,github_repo_full_name,ai_model,updated_at")
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else setProjects(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: name.trim(), description: desc.trim() || null, owner_id: u.user.id })
      .select()
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("audit_log").insert({
      user_id: u.user.id,
      project_id: data.id,
      action: "project.create",
      target: data.name,
    });
    toast.success("Project created");
    setOpen(false);
    setName("");
    setDesc("");
    navigate({ to: "/projects/$id", params: { id: data.id } });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-mono font-bold text-primary text-glow">
            <Terminal className="h-5 w-5" /> codex.green
          </Link>
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-muted-foreground hidden sm:inline">{email}</span>
            <Link to="/settings"><Button variant="ghost" size="sm">settings</Button></Link>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" /> exit
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="font-mono text-xs text-primary">$ ls projects/</div>
            <h1 className="font-mono text-2xl mt-1">your projects</h1>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="font-mono hover:glow"><Plus className="h-4 w-4 mr-1" /> new project</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-mono">create project</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="font-mono text-xs">name</Label>
                  <Input className="font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-agent-app" />
                </div>
                <div className="space-y-2">
                  <Label className="font-mono text-xs">description</Label>
                  <Textarea className="font-mono" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="what does it do?" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)} className="font-mono">cancel</Button>
                <Button onClick={create} disabled={creating || !name.trim()} className="font-mono hover:glow">
                  {creating ? "creating..." : "$ init"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="font-mono text-muted-foreground text-sm">$ loading...</div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-16 text-center">
            <FolderGit2 className="h-8 w-8 text-primary mx-auto" />
            <p className="mt-4 font-mono text-sm text-muted-foreground">no projects yet.</p>
            <p className="font-mono text-xs text-muted-foreground">click "new project" to spin one up.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} to="/projects/$id" params={{ id: p.id }}>
                <Card className="transition-all hover:border-primary/60 cursor-pointer bg-card">
                  <CardHeader>
                    <CardTitle className="font-mono text-primary text-base truncate">{p.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                      {p.description || <span className="font-mono">// no description</span>}
                    </p>
                    <div className="font-mono text-xs text-muted-foreground flex items-center justify-between">
                      <span>{p.github_repo_full_name ?? "no repo"}</span>
                      <span className="text-primary">{p.ai_model.split("/")[1]?.split("-").slice(0, 2).join("-") ?? p.ai_model}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
