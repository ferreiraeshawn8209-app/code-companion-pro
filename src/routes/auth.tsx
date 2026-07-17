import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Terminal } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Codex Green" },
      { name: "description", content: "Access your Codex Green console." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmail = async (mode: "signin" | "signup") => {
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. Check your email to confirm (if required).");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
        navigate({ to: "/dashboard" });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      navigate({ to: "/dashboard" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 font-mono text-primary text-glow mb-8">
          <Terminal className="h-5 w-5" />
          codex.green
        </Link>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-6 text-center">
            <div className="font-mono text-xs text-primary">$ auth --login</div>
            <h1 className="mt-2 text-xl font-mono">access console</h1>
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full font-mono">
              <TabsTrigger value="signin">sign in</TabsTrigger>
              <TabsTrigger value="signup">sign up</TabsTrigger>
            </TabsList>

            {(["signin", "signup"] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor={`email-${tab}`} className="font-mono text-xs">email</Label>
                  <Input
                    id={`email-${tab}`}
                    type="email"
                    autoComplete="email"
                    className="font-mono"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`pw-${tab}`} className="font-mono text-xs">password</Label>
                  <Input
                    id={`pw-${tab}`}
                    type="password"
                    autoComplete={tab === "signin" ? "current-password" : "new-password"}
                    className="font-mono"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full font-mono hover:glow"
                  disabled={loading || !email || !password}
                  onClick={() => handleEmail(tab)}
                >
                  {loading ? "..." : tab === "signin" ? "$ login" : "$ create"}
                </Button>
              </TabsContent>
            ))}
          </Tabs>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground font-mono">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            variant="outline"
            className="w-full font-mono"
            disabled={loading}
            onClick={handleGoogle}
          >
            continue with google
          </Button>
        </div>
      </div>
    </div>
  );
}
