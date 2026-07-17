import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Terminal, GitBranch, Sparkles, Shield } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-mono text-lg font-bold text-primary text-glow">
            <Terminal className="h-5 w-5" />
            codex.green
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" className="font-mono">sign in</Button>
            </Link>
            <Link to="/auth">
              <Button className="font-mono hover:glow">launch console →</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <div className="font-mono text-xs text-primary text-glow">$ codex init --agent</div>
        <h1 className="mt-6 text-5xl md:text-7xl font-mono font-bold tracking-tight">
          <span className="text-foreground">an AI that ships</span>
          <br />
          <span className="text-primary text-glow">production code</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Connect a GitHub repo. Chat with a multi-model agent. Review diffs. Merge PRs.
          Deploy — with human approval at every destructive step.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Link to="/auth">
            <Button size="lg" className="font-mono hover:glow">$ start free →</Button>
          </Link>
          <a href="https://github.com" target="_blank" rel="noreferrer">
            <Button size="lg" variant="outline" className="font-mono">view repos</Button>
          </a>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: GitBranch, title: "github native", body: "Auth, browse repos, read entire codebases. Branch, commit, PR — with approval." },
            { icon: Sparkles, title: "multi-model AI", body: "Gemini, GPT-5, Claude — swap providers per project. Streaming reasoning built-in." },
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
          [ codex.green ]  © {new Date().getFullYear()}  ·  human-in-the-loop AI engineering
        </div>
      </footer>
    </div>
  );
}
// touch
