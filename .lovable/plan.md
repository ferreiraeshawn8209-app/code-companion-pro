
# AI Coding Agent — Build Plan

The full spec (multi-provider AI, Vercel deploys, Supabase admin, terminal, live preview, encrypted keys, RBAC, audit log, memory, deployments to many clouds) is a multi-month product. I'll ship it in phases so each phase is usable on its own. Phase 1 is what actually gets built in this first pass; later phases are scoped but not implemented yet.

## Visual direction
Terminal green on black: bg `#000000`, surface `#0f1f0f`, primary `#39ff14`, text `#e5e5e5`. Monospace headings (JetBrains Mono), Inter for body. Subtle scanline/CRT accents, no purple/indigo. Dark mode only.

## Phase 1 — Foundation (this build)

**Backend (Lovable Cloud)**
- Enable Cloud (Supabase).
- Tables: `profiles`, `user_roles` (enum: admin, member), `projects`, `project_members`, `github_connections` (encrypted token ref), `ai_sessions`, `ai_messages`, `audit_log`.
- RLS: every table scoped by `auth.uid()` via `project_members`; `has_role()` security-definer fn for admin checks.
- Grants for `authenticated` + `service_role` on all public tables.

**Auth**
- Email/password + Google OAuth (via `supabase--configure_social_auth`).
- Managed `_authenticated/route.tsx` gate. Public landing at `/`.

**Routes**
- `/` — public landing (hero + sign-in CTA)
- `/auth` — sign in / sign up
- `/_authenticated/dashboard` — project list + create
- `/_authenticated/projects/$id` — project workspace shell (tabs: Chat, Files, Deployments, Settings)
- `/_authenticated/settings` — profile, API keys UI (stubs for later)

**Project workspace (v1 scope)**
- **Chat tab**: streaming AI chat via `/api/chat` using Lovable AI Gateway (`google/gemini-3.5-flash` default), reasoning surfaced, per-project session persisted to `ai_messages`.
- **Files tab**: Monaco editor + file tree. In v1, backed by an in-memory/DB "virtual workspace" tied to the project (real GitHub sync in Phase 2).
- **Deployments tab**: placeholder with "Connect Vercel" CTA (Phase 3).
- **Diff viewer** component (react-diff-viewer) for AI-proposed changes with Approve/Reject.
- **Audit log** writes on every AI action and destructive op.

**GitHub integration (v1 slice)**
- OAuth connect flow via `standard_connectors--connect` (GitHub connector).
- List user repos, view repo tree + file contents (read-only in v1).
- Server functions only; token never touches browser.

**AI provider abstraction**
- `src/lib/ai/providers/` with `lovable.ts` (default). Interface ready for `openai.ts`, `anthropic.ts`, `gemini.ts`, `deepseek.ts`, `ollama.ts` (Phase 2).
- BYO-key UI in Settings (encrypted at rest via pgcrypto + `APP_SECRETS_KEY`), disabled with "coming soon" toggles in v1.

**UX**
- shadcn components restyled to terminal palette.
- Streaming indicators, toast notifications (sonner), command palette (⌘K) for project switch.
- Responsive: dashboard + settings work on mobile; workspace is desktop-first with a mobile "open on desktop" notice.

**Security baseline**
- RLS everywhere, service-role only in `.server.ts`, admin fns re-check role via `has_role()`.
- Explicit user approval modal before: applying AI file changes, deleting files, running SQL, deploying.
- Audit log page (admin-only) under `/_authenticated/admin/audit`.

## Phase 2 — Real code operations (next build)
Full GitHub write ops (create/edit/delete files, branches, commits, push, PRs, conflict view), multi-file AI edits with plan → apply flow, project memory (embeddings on codebase), task queue with step-by-step execution and rollback, project search across repo.

## Phase 3 — Deployment & infra
Vercel connector (deploy, logs, preview vs prod, failure diagnosis), Supabase admin panel (migrations, tables/policies, buckets, users, edge fns) with approval gates, xterm.js terminal wired to a sandboxed exec function, live preview iframe.

## Phase 4 — Extensibility
Provider registry for OpenAI/Anthropic/Gemini/DeepSeek/Ollama with BYO keys, integration registry scaffolding for Docker/Cloudflare/AWS/Azure/DO/Railway/Firebase/MySQL, RBAC UI, team invites.

## Technical notes
- Stack: TanStack Start (already scaffolded), React 19, Tailwind v4, shadcn, Monaco (`@monaco-editor/react`), AI SDK + `@ai-sdk/openai-compatible` via Lovable AI Gateway.
- Server fns in `src/lib/*.functions.ts`, admin ops load `client.server` inside handlers.
- Chat streaming route at `src/routes/api/chat.ts` following the Lovable AI Gateway pattern with run-id forwarding.
- GitHub calls go through the connector gateway (`connector-gateway.lovable.dev/github`), never direct.
- Design tokens in `src/styles.css` (oklch); no hardcoded colors in components.

## What's explicitly deferred out of Phase 1
Live terminal execution, real deploy pipelines, cross-file AI refactors with auto-apply, embeddings-based project memory, MySQL/other DB connectors, Docker/AWS/etc. integrations, merge-conflict resolver UI, RBAC beyond admin/member, notifications beyond in-app toasts.

Approve to start building Phase 1.
