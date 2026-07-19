## What I found

1. **Login "not working"** — the auth logs show your Google sign-in actually succeeded, but the OAuth `redirect_uri` is `window.location.origin` (the landing page `/`), and the landing page is fully static: it has no session listener and always shows "sign in / launch console" in the header, regardless of whether you're signed in. So after Google finishes, you land back on the homepage that looks identical to a logged-out state — reads as "login didn't work".
2. **Rebrand to `spok` is incomplete** — 7 files still say `codex.green` / "Codex Green" (landing, auth, dashboard, settings, `__root`, chat API, vercel functions).
3. **Vercel deploy** — pipeline + `DeployPanel` are already wired in the workspace `deploy` tab. Just needs a smoke test.
4. **Voice** — no STT/TTS anywhere yet.

## Fixes this turn

### 1. Login flow
- Landing page (`src/routes/index.tsx`): subscribe to `supabase.auth.getUser()` + `onAuthStateChange`. If signed in, swap the header CTAs for **"open console → /dashboard"** + **"sign out"**, and change the hero CTA to `$ open console →`.
- Auth page (`src/routes/auth.tsx`): pass `redirect_uri: ${window.location.origin}/auth` (public route, iframe-safe) and, after `onAuthStateChange` fires `SIGNED_IN` on return, navigate straight to `/dashboard`.

### 2. Rebrand → spok
Search-replace `codex.green` → `spok` and "Codex Green" → "spok" across the 7 files. Update `<title>` and meta descriptions in `__root.tsx` + `auth.tsx` head().

### 3. Voice I/O in the agent chat
Add two thin server routes and a mic button in `ChatPanel`:
- `POST /api/public/stt` — accepts a WAV upload, forwards to Lovable AI Gateway `/v1/audio/transcriptions` with `openai/gpt-4o-mini-transcribe` (SSE streaming), returns transcript.
- `POST /api/public/tts` — accepts `{ text }`, forwards to `/v1/audio/speech` with `openai/gpt-4o-mini-tts`, `stream_format: sse`, `response_format: pcm`, pipes SSE back.
- `ChatPanel` gets:
  - 🎤 button → Web Audio API captures PCM → uploads WAV → transcript populates the input textarea (user can edit before sending).
  - 🔊 auto-play toggle → when the assistant finishes streaming, pipe the reply through `/api/public/tts` and play the PCM chunks on an `AudioContext` (24 kHz mono).

Both routes are server-only, use `LOVABLE_API_KEY` (already in secrets), and validate MIME/size before forwarding.

### 4. Vercel deploy smoke test
Verify `VERCEL_TOKEN` is set (it is) and that `vercelWhoami` returns from the workspace `deploy` tab. Fix any wiring issues if the UI doesn't call through.

### 5. "Find bugs / be creative" system prompt upgrade
Extend the chat system prompt in `src/routes/api/chat.ts` so the agent is instructed to: propose fixes proactively, call out likely bugs it sees in the shared files list, and suggest UX/design improvements on its own initiative — not just answer literal questions.

## Files touched
- `src/routes/index.tsx` — session-aware header
- `src/routes/auth.tsx` — redirect target + branding
- `src/routes/__root.tsx` — title/meta
- `src/routes/_authenticated/dashboard.tsx`, `settings.tsx` — branding
- `src/routes/api/chat.ts` — branding + smarter system prompt
- `src/lib/vercel.functions.ts` — comment branding
- `src/components/workspace/ChatPanel.tsx` — mic + speaker
- `src/routes/api/public/stt.ts` — new
- `src/routes/api/public/tts.ts` — new

## Out of scope (say the word and I'll add next turn)
- Wake-word / continuous conversation mode (push-to-talk only this pass)
- Voice choice picker (defaults to `alloy`)
- Native mobile mic permissions polish (Capacitor already installed)
