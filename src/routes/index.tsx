import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Terminal, GitBranch, Sparkles, Shield, Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "spok — AI coding agent" },
      {
        name: "description",
        content:
          "spok is an AI software engineering agent: connect a repo, chat (voice or text), review diffs, deploy to Vercel — with human approval.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setSignedIn(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSignedIn(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-mono text-lg font-bold text-primary text-glow">
            <Terminal className="h-5 w-5" />
            spok
          </Link>
          <div className="flex items-center gap-3">
            {signedIn ? (
              <>
                <Button
                  variant="ghost"
                  className="font-mono"
                  onClick={handleSignOut}
                >
                  sign out
                </Button>
                <Button
                  className="font-mono hover:glow"
                  onClick={() => navigate({ to: "/dashboard" })}
                >
                  open console →
                </Button>
              </>
            ) : (
              <>
                <Link to="/auth">
                  <Button variant="ghost" className="font-mono">sign in</Button>
                </Link>
                <Link to="/auth">
                  <Button className="font-mono hover:glow">launch console →</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <div className="font-mono text-xs text-primary text-glow">$ spok init --agent</div>
        <h1 className="mt-6 text-5xl md:text-7xl font-mono font-bold tracking-tight">
          <span className="text-foreground">an AI that ships</span>
          <br />
          <span className="text-primary text-glow">production code</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Connect a repo. Talk to the agent (voice or text). Review diffs. Deploy to Vercel.
          Human-in-the-loop at every destructive step.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          {signedIn ? (
            <Button size="lg" className="font-mono hover:glow" onClick={() => navigate({ to: "/dashboard" })}>
              $ open console →
            </Button>
          ) : (
            <Link to="/auth">
              <Button size="lg" className="font-mono hover:glow">$ start free →</Button>
            </Link>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-4">
          {[
            { icon: GitBranch, title: "github native", body: "Auth, browse repos, read entire codebases. Branch, commit, PR — with approval." },
            { icon: Sparkles, title: "multi-model AI", body: "Gemini, GPT, Claude — swap providers per project. Streaming reasoning built-in." },
            { icon: Mic, title: "voice-first", body: "Push-to-talk to the agent. Assistant replies play back as audio. Both directions." },
            { icon: Shield, title: "you approve", body: "Every file write, SQL, and deploy needs your OK. Full audit log per project." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-6 transition-all hover:border-primary/60">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-mono text-lg text-primary">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-6 font-mono text-xs text-muted-foreground">
          [ spok ]  © {new Date().getFullYear()}  ·  human-in-the-loop AI engineering
        </div>
      </footer>
    </div>
  );
}
