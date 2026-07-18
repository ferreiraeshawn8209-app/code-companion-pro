import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Smartphone, Apple, Copy, Check } from "lucide-react";

type Props = {
  projectId: string;
  projectName: string;
  initialAppId: string | null;
  initialAppName: string | null;
  initialLiveReload: boolean;
};

const publishedUrl = "https://spokcodeagent.lovable.app";

export function MobilePanel({ projectId, projectName, initialAppId, initialAppName, initialLiveReload }: Props) {
  const [appId, setAppId] = useState(initialAppId ?? `green.codex.${projectName.toLowerCase().replace(/[^a-z0-9]/g, "")}`);
  const [appName, setAppName] = useState(initialAppName ?? projectName);
  const [liveReload, setLiveReload] = useState(initialLiveReload);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update({
        mobile_app_id: appId,
        mobile_app_name: appName,
        mobile_live_reload: liveReload,
      })
      .eq("id", projectId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("mobile config saved");
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      project_id: projectId,
      user_id: u.user?.id,
      action: "mobile.configure",
      target: `${appId} (live-reload=${liveReload})`,
    });
  };

  const capacitorConfig = `import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "${appId}",
  appName: "${appName}",
  webDir: "dist",
  bundledWebRuntime: false,${liveReload ? `
  server: {
    url: "${publishedUrl}",
    cleartext: true,
    androidScheme: "https",
  },` : ""}
  android: { allowMixedContent: true },
  ios: { contentInset: "always" },
};

export default config;`;

  const androidSteps = `# 1. Save capacitor.config.ts (above), then:
bun run build
bunx cap add android
bunx cap sync android

# 2. Open in Android Studio:
bunx cap open android

# 3. Run on connected device / emulator:
bunx cap run android`;

  const iosSteps = `# Requires macOS + Xcode + CocoaPods (sudo gem install cocoapods)
bun run build
bunx cap add ios
bunx cap sync ios
bunx cap open ios     # then Run in Xcode
# or:
bunx cap run ios`;

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
    toast.success("copied");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4 space-y-4">
        <div className="font-mono text-xs text-primary">$ mobile app config</div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="font-mono text-xs text-muted-foreground">app id (reverse-dns)</Label>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="mt-1 font-mono text-xs h-9"
              placeholder="green.codex.myapp"
            />
          </div>
          <div>
            <Label className="font-mono text-xs text-muted-foreground">display name</Label>
            <Input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="mt-1 font-mono text-xs h-9"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded border border-border p-3">
          <div>
            <div className="font-mono text-xs">live-reload from published preview</div>
            <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
              native shell loads {publishedUrl} — UI updates without rebuilding the app
            </div>
          </div>
          <Switch checked={liveReload} onCheckedChange={setLiveReload} />
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving} className="font-mono h-8 text-xs">
            {saving ? "..." : "save"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-xs text-primary">$ capacitor.config.ts</div>
          <Button size="sm" variant="ghost" className="font-mono h-7 text-xs" onClick={() => copy("cfg", capacitorConfig)}>
            {copied === "cfg" ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            copy
          </Button>
        </div>
        <pre className="bg-background border border-border rounded p-3 font-mono text-[11px] text-muted-foreground overflow-auto max-h-52">
{capacitorConfig}
        </pre>
        <p className="font-mono text-[11px] text-muted-foreground">
          Save this at the repo root. The value here is generated from your settings above — the checked-in
          <span className="text-primary"> capacitor.config.ts</span> ships with sensible defaults you can override.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs text-primary flex items-center gap-2">
              <Smartphone className="h-3 w-3" /> android
            </div>
            <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">ready</Badge>
          </div>
          <pre className="bg-background border border-border rounded p-3 font-mono text-[11px] text-muted-foreground overflow-auto max-h-64">
{androidSteps}
          </pre>
          <Button size="sm" variant="ghost" className="font-mono h-7 text-xs w-full" onClick={() => copy("and", androidSteps)}>
            {copied === "and" ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            copy commands
          </Button>
        </div>

        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs text-primary flex items-center gap-2">
              <Apple className="h-3 w-3" /> ios
            </div>
            <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">ready</Badge>
          </div>
          <pre className="bg-background border border-border rounded p-3 font-mono text-[11px] text-muted-foreground overflow-auto max-h-64">
{iosSteps}
          </pre>
          <Button size="sm" variant="ghost" className="font-mono h-7 text-xs w-full" onClick={() => copy("ios", iosSteps)}>
            {copied === "ios" ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            copy commands
          </Button>
        </div>
      </div>
    </div>
  );
}
