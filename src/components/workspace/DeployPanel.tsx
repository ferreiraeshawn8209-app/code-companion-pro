import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  vercelWhoami,
  listVercelProjects,
  createVercelProject,
  linkVercelProject,
  deployToVercel,
  getDeploymentStatus,
  getDeploymentEvents,
  listProjectDeployments,
} from "@/lib/vercel.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Rocket, RefreshCcw, Terminal, ExternalLink, Loader2 } from "lucide-react";

type Props = {
  projectId: string;
  projectName: string;
  vercelProjectName: string | null;
  onLinked?: (name: string) => void;
};

type Deployment = {
  id: string;
  deployment_id: string | null;
  deployment_url: string | null;
  target: string;
  state: string;
  created_at: string;
};

const STATE_COLOR: Record<string, string> = {
  READY: "text-primary border-primary/40",
  BUILDING: "text-yellow-400 border-yellow-400/40",
  QUEUED: "text-muted-foreground border-border",
  ERROR: "text-destructive border-destructive/40",
  CANCELED: "text-muted-foreground border-border",
};

export function DeployPanel({ projectId, projectName, vercelProjectName, onLinked }: Props) {
  const whoami = useServerFn(vercelWhoami);
  const listProjects = useServerFn(listVercelProjects);
  const createProject = useServerFn(createVercelProject);
  const linkProject = useServerFn(linkVercelProject);
  const deploy = useServerFn(deployToVercel);
  const status = useServerFn(getDeploymentStatus);
  const events = useServerFn(getDeploymentEvents);
  const listDeps = useServerFn(listProjectDeployments);

  const [me, setMe] = useState<{ username: string; email: string; teams: Array<{ id: string; slug: string }> } | null>(null);
  const [checking, setChecking] = useState(true);
  const [teamId, setTeamId] = useState<string | undefined>();
  const [remoteProjects, setRemoteProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [newName, setNewName] = useState(projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
  const [linked, setLinked] = useState<string | null>(vercelProjectName);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<Array<{ text: string; created: number }>>([]);
  const [activeDeploymentId, setActiveDeploymentId] = useState<string | null>(null);
  const [target, setTarget] = useState<"preview" | "production">("preview");

  useEffect(() => {
    (async () => {
      setChecking(true);
      const r = await whoami();
      if (r.ok) setMe({ username: r.username, email: r.email, teams: r.teams });
      else setMe(null);
      setChecking(false);
    })();
  }, []);

  useEffect(() => {
    if (!me) return;
    (async () => {
      const p = await listProjects({ data: { teamId } });
      setRemoteProjects(p);
    })();
  }, [me, teamId]);

  const refreshDeployments = async () => {
    const rows = (await listDeps({ data: { projectId } })) as Deployment[];
    setDeployments(rows);
  };
  useEffect(() => {
    refreshDeployments();
  }, [projectId]);

  // Poll active deployment
  useEffect(() => {
    if (!activeDeploymentId) return;
    const row = deployments.find((d) => d.deployment_id === activeDeploymentId);
    if (!row || row.state === "READY" || row.state === "ERROR" || row.state === "CANCELED") return;
    const t = setInterval(async () => {
      try {
        const s = await status({ data: { deploymentId: activeDeploymentId, rowId: row.id, teamId } });
        setDeployments((prev) => prev.map((d) => (d.id === row.id ? { ...d, state: s.state } : d)));
        const evs = await events({ data: { deploymentId: activeDeploymentId, teamId } });
        setLogs(evs.filter((e) => e.text).slice(-80));
        if (s.state === "READY" || s.state === "ERROR" || s.state === "CANCELED") {
          clearInterval(t);
        }
      } catch (e) {
        console.error(e);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [activeDeploymentId, deployments, teamId]);

  const doLink = async (vId: string, vName: string) => {
    await linkProject({ data: { projectId, vercelProjectId: vId, vercelProjectName: vName } });
    setLinked(vName);
    onLinked?.(vName);
    toast.success(`linked to ${vName}`);
  };

  const doCreate = async () => {
    try {
      const p = await createProject({ data: { name: newName, framework: "vite", teamId } });
      await doLink(p.id, p.name);
      const list = await listProjects({ data: { teamId } });
      setRemoteProjects(list);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doDeploy = async () => {
    setDeploying(true);
    setLogs([]);
    try {
      const r = await deploy({ data: { projectId, target, teamId } });
      toast.success("deployment queued");
      setActiveDeploymentId(r.deploymentId);
      await refreshDeployments();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeploying(false);
    }
  };

  if (checking) {
    return <div className="p-8 font-mono text-xs text-muted-foreground">$ verifying vercel token...</div>;
  }

  if (!me) {
    return (
      <div className="rounded-md border border-destructive/40 bg-card p-6">
        <div className="font-mono text-sm text-destructive mb-2">$ vercel token missing or invalid</div>
        <p className="font-mono text-xs text-muted-foreground">
          The workspace VERCEL_TOKEN secret is not set or was rejected by Vercel.
          Generate a token at{" "}
          <a className="text-primary" target="_blank" rel="noreferrer" href="https://vercel.com/account/tokens">
            vercel.com/account/tokens
          </a>{" "}
          and save it as the <span className="text-primary">VERCEL_TOKEN</span> secret, then reload.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="font-mono text-xs">
            <span className="text-muted-foreground">$ vercel whoami →</span>{" "}
            <span className="text-primary">{me.username}</span>{" "}
            <span className="text-muted-foreground">({me.email})</span>
          </div>
          {me.teams.length > 0 && (
            <Select value={teamId ?? "personal"} onValueChange={(v) => setTeamId(v === "personal" ? undefined : v)}>
              <SelectTrigger className="w-[220px] h-8 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal" className="font-mono text-xs">personal</SelectItem>
                {me.teams.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="font-mono text-xs">team: {t.slug}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4 space-y-3">
        <div className="font-mono text-xs text-primary">$ link vercel project</div>
        {linked ? (
          <div className="font-mono text-xs flex items-center gap-2">
            <Badge variant="outline" className="font-mono border-primary/40 text-primary">{linked}</Badge>
            <button className="text-muted-foreground underline hover:text-foreground" onClick={() => setLinked(null)}>change</button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Select onValueChange={(v) => {
                const p = remoteProjects.find((x) => x.id === v);
                if (p) doLink(p.id, p.name);
              }}>
                <SelectTrigger className="flex-1 h-8 font-mono text-xs">
                  <SelectValue placeholder="select existing project..." />
                </SelectTrigger>
                <SelectContent>
                  {remoteProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="font-mono text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 items-center">
              <span className="font-mono text-xs text-muted-foreground">or create new:</span>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 font-mono text-xs flex-1"
                placeholder="my-app"
              />
              <Button size="sm" onClick={doCreate} className="font-mono h-8 text-xs">create</Button>
            </div>
          </>
        )}
      </div>

      <div className="rounded-md border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-xs text-primary">$ deploy</div>
          <div className="flex items-center gap-2">
            <Select value={target} onValueChange={(v: "preview" | "production") => setTarget(v)}>
              <SelectTrigger className="w-[140px] h-8 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview" className="font-mono text-xs">preview</SelectItem>
                <SelectItem value="production" className="font-mono text-xs">production</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={doDeploy} disabled={!linked || deploying} className="font-mono h-8 text-xs">
              {deploying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Rocket className="h-3 w-3 mr-1" />}
              deploy
            </Button>
            <Button size="sm" variant="ghost" onClick={refreshDeployments} className="font-mono h-8 text-xs">
              <RefreshCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {activeDeploymentId && (
          <div className="rounded border border-border bg-background p-2 max-h-52 overflow-auto font-mono text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2 pb-1 text-primary">
              <Terminal className="h-3 w-3" /> build log
            </div>
            {logs.length === 0 ? "// waiting for events..." : logs.map((l, i) => <div key={i}>{l.text}</div>)}
          </div>
        )}

        <div className="divide-y divide-border">
          {deployments.length === 0 ? (
            <div className="font-mono text-xs text-muted-foreground py-4">// no deployments yet</div>
          ) : (
            deployments.map((d) => (
              <div key={d.id} className="py-2 flex items-center justify-between font-mono text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className={`font-mono text-[10px] ${STATE_COLOR[d.state] ?? "border-border"}`}>
                    {d.state.toLowerCase()}
                  </Badge>
                  <span className="text-muted-foreground">{d.target}</span>
                  <a
                    href={d.deployment_url ? `https://${d.deployment_url}` : "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline truncate max-w-md"
                  >
                    {d.deployment_url ?? "—"}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{new Date(d.created_at).toLocaleString()}</span>
                  {d.deployment_url && (
                    <a href={`https://${d.deployment_url}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-primary" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
