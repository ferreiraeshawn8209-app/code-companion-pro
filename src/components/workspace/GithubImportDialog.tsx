import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Github, Download, Search, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { listGithubRepos, importGithubRepo, type GhRepo } from "@/lib/github.functions";

interface Props {
  projectId: string;
  onImported: () => void;
}

export function GithubImportDialog({ projectId, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list = useServerFn(listGithubRepos);
  const doImport = useServerFn(importGithubRepo);

  useEffect(() => {
    if (!open || repos.length > 0) return;
    setLoading(true);
    setError(null);
    list()
      .then((r) => setRepos(r))
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = repos.filter((r) =>
    r.full_name.toLowerCase().includes(query.toLowerCase()),
  );

  const handleImport = async (repo: GhRepo) => {
    setImporting(repo.full_name);
    try {
      const res = await doImport({
        data: { projectId, fullName: repo.full_name, branch: repo.default_branch },
      });
      toast.success(`imported ${res.imported} files from ${repo.full_name}${res.truncated ? " (truncated)" : ""}`);
      setOpen(false);
      onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "import failed");
    } finally {
      setImporting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="font-mono h-8 text-xs border-border">
          <Github className="h-3 w-3 mr-1" /> import repo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary">$ github import</DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            pull a repository into this project's workspace. text files up to 200KB, max 400 files.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="filter repos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-7 h-8 font-mono text-xs"
          />
        </div>

        <div className="max-h-[420px] overflow-y-auto border border-border rounded-md">
          {loading ? (
            <div className="p-6 text-center font-mono text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> loading repos...
            </div>
          ) : error ? (
            <div className="p-6 font-mono text-xs text-destructive">// {error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 font-mono text-xs text-muted-foreground">// no repositories</div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-3 hover:bg-accent/40">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="text-primary truncate">{r.full_name}</span>
                      {r.private && (
                        <Badge variant="outline" className="font-mono text-[10px] border-border h-4">
                          <Lock className="h-2.5 w-2.5 mr-0.5" /> private
                        </Badge>
                      )}
                      <span className="text-muted-foreground text-[10px]">{r.default_branch}</span>
                    </div>
                    {r.description && (
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {r.description}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="font-mono h-7 text-xs shrink-0"
                    disabled={importing !== null}
                    onClick={() => handleImport(r)}
                  >
                    {importing === r.full_name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <><Download className="h-3 w-3 mr-1" /> import</>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
