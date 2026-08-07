import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Smartphone, Apple, Copy, Check, Rocket, Info } from "lucide-react";

type Props = {
  projectId: string;
  projectName: string;
  initialAppId: string | null;
  initialAppName: string | null;
  initialLiveReload: boolean;
};

const publishedUrl = "https://spokcodeagent.lovable.app";

export function MobilePanel({
  projectId,
  projectName,
  initialAppId,
  initialAppName,
  initialLiveReload,
}: Props) {
  const [appId, setAppId] = useState(
    initialAppId ??
      `green.codex.${projectName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
  );
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
  android: { allowMixedContent: ${liveReload} },
  ios: { contentInset: "always" },
};

export default config;`;

  const androidOption2 = `# prerequisites: Node 20+, bun, Android Studio, JDK 17
# (Android Studio installs SDK + platform-tools automatically)

# 1. build the web app into dist/
bun run build

# 2. add the android platform (one-time)
bun run cap:add:android

# 3. copy dist/ into the native project (bundled, offline)
bun run cap:sync:android

# 4. open Android Studio
bun run cap:open:android

# shortcut for steps 1 + 3 + 4:
# bun run cap:build:android

# 5. signed release for the Play Store:
#    Android Studio -> Build -> Generate Signed Bundle / APK
#    -> Android App Bundle (.aab) -> create/choose keystore -> release
#    keep the keystore + passwords safe, they are required for every update

# 6. every future release: repeat steps 1 + 3, then rebuild the signed bundle`;

  const iosSteps = `# requires macOS + Xcode + CocoaPods
bun run build
bunx cap add ios
bunx cap sync ios
bunx cap open ios
# Xcode -> Product -> Archive -> Distribute App`;

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
    toast.success("copied");
  };

  return (
    <div className="space-y-6">
      {/* Option 2 banner */}
      <div className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <div className="font-mono text-sm text-primary">
            active: option 2 — bundled offline build
          </div>
          <Badge
            variant="outline"
            className="font-mono text-[10px] border-primary/40 text-primary"
          >
            store ready
          </Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground leading-relaxed">
          The web build in <span className="text-primary">dist/</span> is
          packaged inside the native app, so it runs offline and can be
          submitted to the Play Store / App Store. Each release needs a rebuild
          and re-sync.
        </p>
        <div className="flex items-start gap-2 text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p className="font-mono text-[11px] leading-relaxed">
            Leave live-reload off for release builds. Flip it on only while
            iterating on UI against the published preview.
          </p>
        </div>
      </div>


      {/* Config form */}
      <div className="rounded-md border border-border bg-card p-4 space-y-4">
        <div className="font-mono text-xs text-primary">$ mobile app config</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="font-mono text-xs text-muted-foreground">
              app id (reverse-dns)
            </Label>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="mt-1 font-mono text-xs h-9"
              placeholder="green.codex.myapp"
            />
          </div>
          <div>
            <Label className="font-mono text-xs text-muted-foreground">
              display name
            </Label>
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
              native shell loads {publishedUrl} — UI updates without rebuilding
              the app
            </div>
          </div>
          <Switch checked={liveReload} onCheckedChange={setLiveReload} />
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={save}
            disabled={saving}
            className="font-mono h-8 text-xs"
          >
            {saving ? "..." : "save"}
          </Button>
        </div>
      </div>

      {/* Capacitor config */}
      <div className="rounded-md border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-xs text-primary">
            $ capacitor.config.ts
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="font-mono h-7 text-xs"
            onClick={() => copy("cfg", capacitorConfig)}
          >
            {copied === "cfg" ? (
              <Check className="h-3 w-3 mr-1" />
            ) : (
              <Copy className="h-3 w-3 mr-1" />
            )}
            copy
          </Button>
        </div>
        <pre className="bg-background border border-border rounded p-3 font-mono text-[11px] text-muted-foreground overflow-auto max-h-52">
          {capacitorConfig}
        </pre>
        <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
          Save this at the repo root. The checked-in
          <span className="text-primary"> capacitor.config.ts</span> is already
          configured for Option 2 (bundled offline, no server block).
        </p>
      </div>

      {/* Build steps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs text-primary flex items-center gap-2">
              <Smartphone className="h-3 w-3" /> android — option 2
            </div>
            <Badge
              variant="outline"
              className="font-mono text-[10px] border-primary/40 text-primary"
            >
              bundled
            </Badge>
          </div>
          <pre className="bg-background border border-border rounded p-3 font-mono text-[11px] text-muted-foreground overflow-auto max-h-80">
            {androidOption2}
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="font-mono h-7 text-xs w-full"
            onClick={() => copy("and", androidOption2)}

          >
            {copied === "and" ? (
              <Check className="h-3 w-3 mr-1" />
            ) : (
              <Copy className="h-3 w-3 mr-1" />
            )}
            copy commands
          </Button>
        </div>

        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs text-primary flex items-center gap-2">
              <Apple className="h-3 w-3" /> ios
            </div>
            <Badge
              variant="outline"
              className="font-mono text-[10px] border-border text-muted-foreground"
            >
              later
            </Badge>
          </div>
          <pre className="bg-background border border-border rounded p-3 font-mono text-[11px] text-muted-foreground overflow-auto max-h-80">
            {iosSteps}
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="font-mono h-7 text-xs w-full"
            onClick={() => copy("ios", iosSteps)}
          >
            {copied === "ios" ? (
              <Check className="h-3 w-3 mr-1" />
            ) : (
              <Copy className="h-3 w-3 mr-1" />
            )}
            copy commands
          </Button>
        </div>
      </div>
    </div>
  );
}
