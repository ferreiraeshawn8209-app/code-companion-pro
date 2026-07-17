import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Terminal } from "lucide-react";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setEmail(u.user.email ?? "");
      const { data } = await supabase.from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
      setName(data?.display_name ?? "");
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: u.user.id, email, display_name: name });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-mono text-primary text-glow">
            <Terminal className="h-5 w-5" /> codex.green
          </Link>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })} className="font-mono">
            <ArrowLeft className="h-4 w-4 mr-1" /> back
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10 space-y-8">
        <div>
          <div className="font-mono text-xs text-primary">$ settings</div>
          <h1 className="font-mono text-2xl mt-1">console preferences</h1>
        </div>

        <Card className="bg-card">
          <CardHeader><CardTitle className="font-mono text-primary">profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs">email</Label>
              <Input value={email} disabled className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs">display name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="font-mono" />
            </div>
            <Button onClick={save} disabled={saving} className="font-mono hover:glow">
              {saving ? "saving..." : "$ save"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="font-mono text-primary">AI providers</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {AI_PROVIDERS.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="font-mono text-sm flex items-center gap-2">
                    {p.label}
                    {p.enabled ? <Badge className="bg-primary text-primary-foreground">active</Badge> : <Badge variant="outline" className="border-border">soon</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </div>
                {p.requiresApiKey && (
                  <Button variant="outline" size="sm" disabled className="font-mono">
                    add key
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="font-mono text-primary">integrations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {["GitHub", "Vercel", "Supabase Admin", "Docker", "Cloudflare", "AWS"].map((s) => (
              <div key={s} className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="font-mono text-sm">{s}</div>
                  <div className="text-xs text-muted-foreground">Configure in project workspace</div>
                </div>
                <Badge variant="outline" className="border-border font-mono">
                  {s === "GitHub" ? "phase 1" : "soon"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
