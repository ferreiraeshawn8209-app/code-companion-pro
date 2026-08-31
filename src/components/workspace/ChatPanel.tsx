import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Bot, User, StopCircle, Mic, Square, Volume2, VolumeX, Headphones, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProjectFileRef {
  path: string;
}

interface ChatPanelProps {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  model: string;
  files: ProjectFileRef[];
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
  initialMessages: UIMessage[];
}

// ---- WAV encoder (16-bit PCM mono, downsampled to 16kHz) ------------------
function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const flat = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    flat.set(c, o);
    o += c.length;
  }
  const targetRate = 16000;
  const ratio = sampleRate / targetRate;
  const outLen = Math.floor(flat.length / ratio);
  const down = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) down[i] = flat[Math.floor(i * ratio)];

  const buf = new ArrayBuffer(44 + down.length * 2);
  const view = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  view.setUint32(4, 36 + down.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, down.length * 2, true);
  let p = 44;
  for (let i = 0; i < down.length; i++) {
    const s = Math.max(-1, Math.min(1, down[i]));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    p += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

// ---- PCM streaming playback (24kHz mono s16le) ----------------------------
async function playTtsStream(text: string, ctxRef: React.MutableRefObject<AudioContext | null>) {
  const res = await fetch("/api/public/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`tts ${res.status}`);
  }
  if (!ctxRef.current) ctxRef.current = new AudioContext({ sampleRate: 24000 });
  const ctx = ctxRef.current;
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  let playhead = 0;
  let pending = new Uint8Array(0);

  const schedule = (incoming: Uint8Array) => {
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending);
    bytes.set(incoming, pending.length);
    const usable = bytes.length - (bytes.length % 2);
    pending = bytes.slice(usable);
    if (usable === 0) return;
    const samples = new Int16Array(bytes.buffer.slice(0, usable));
    const floats = Float32Array.from(samples, (s) => s / 32768);
    const buffer = ctx.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    if (playhead === 0) playhead = ctx.currentTime + 0.05;
    else playhead = Math.max(playhead, ctx.currentTime);
    src.start(playhead);
    playhead += buffer.duration;
  };

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let carry = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += value;
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "speech.audio.delta" && evt.audio) {
          const bin = atob(evt.audio);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          schedule(arr);
        }
      } catch {
        /* ignore */
      }
    }
  }

  // wait until the last scheduled buffer has actually finished playing
  const remaining = playhead - ctx.currentTime;
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining * 1000 + 120));
}

/** Strip markdown/code so the speech stays natural and short. */
function toSpeakable(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " (code block omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|\*|_/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3500);
}



export function ChatPanel({
  projectId,
  projectName,
  projectDescription,
  model,
  files,
  sessionId,
  onSessionCreated,
  initialMessages,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceReply, setVoiceReply] = useState(false);
  const [convoMode, setConvoMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [exporting, setExporting] = useState(false);

  const downloadAndroidZip = useCallback(
    async (appId: string, appName: string) => {
      setExporting(true);
      try {
        const res = await exportAndroidProject({
          data: { projectId, appId, appName, liveReloadUrl: null },
        });
        const bin = atob(res.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`packaged ${res.fileCount} files for android studio`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "export failed");
      } finally {
        setExporting(false);
      }
    },
    [projectId],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentSessionRef = useRef<string | null>(sessionId);
  currentSessionRef.current = sessionId;
  const audioCtxRef = useRef<AudioContext | null>(null);
  const convoRef = useRef(false);
  convoRef.current = convoMode;
  const voiceReplyRef = useRef(false);
  voiceReplyRef.current = voiceReply;
  const stopRecordingRef = useRef<() => void>(() => {});
  const startRecordingRef = useRef<() => void>(() => {});
  const recRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    src: MediaStreamAudioSourceNode;
    node: ScriptProcessorNode;
    chunks: Float32Array[];
  } | null>(null);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    id: sessionId ?? "pending",
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: async (): Promise<Record<string, string>> => {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return {};
        return { Authorization: `Bearer ${data.session.access_token}` };
      },
      body: {
        model,
        projectId,
        projectContext: {
          name: projectName,
          description: projectDescription ?? undefined,
          files: files.map((f) => ({ path: f.path })),
        },
      },
    }),
    onError: (err) => toast.error(err.message ?? "chat error"),
    onFinish: async ({ message }) => {
      const sid = currentSessionRef.current;
      if (sid) {
        const { error } = await supabase.from("ai_messages").insert({
          session_id: sid,
          role: "assistant",
          parts: message.parts as unknown as never,
        });
        if (error) console.error("persist assistant:", error);
      }
      if (voiceReplyRef.current || convoRef.current) {
        const text = toSpeakable(
          message.parts.map((p) => (p.type === "text" ? p.text : "")).join(" "),
        );
        if (text) {
          setSpeaking(true);
          try {
            await playTtsStream(text, audioCtxRef);
          } catch (e) {
            console.error("tts:", e);
          } finally {
            setSpeaking(false);
          }
        }
      }
      // hands-free: listen again as soon as the agent stops talking
      if (convoRef.current) startRecordingRef.current();
    },
  });

  useEffect(() => {
    setMessages(initialMessages);
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const isLoading = status === "submitted" || status === "streaming";

  const submitText = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      let sid = currentSessionRef.current;
      if (!sid) {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) {
          toast.error("Not signed in");
          return;
        }
        const { data, error } = await supabase
          .from("ai_sessions")
          .insert({ project_id: projectId, user_id: u.user.id, title: trimmed.slice(0, 60) })
          .select()
          .single();
        if (error || !data) {
          toast.error(error?.message ?? "session error");
          return;
        }
        sid = data.id;
        currentSessionRef.current = sid;
        onSessionCreated(sid);
      }

      const userParts = [{ type: "text" as const, text: trimmed }];
      await supabase.from("ai_messages").insert({
        session_id: sid,
        role: "user",
        parts: userParts,
      });
      await supabase.from("audit_log").insert({
        project_id: projectId,
        action: "ai.prompt",
        target: sid,
        metadata: { model, prompt_length: trimmed.length, voice: convoRef.current },
        user_id: (await supabase.auth.getUser()).data.user?.id,
      });

      setInput("");
      sendMessage({ text: trimmed });
    },
    [projectId, model, onSessionCreated, sendMessage],
  );

  const startRecording = useCallback(async () => {
    if (recRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      let heardSpeech = false;
      let silenceFrames = 0;
      const framesPerSec = ctx.sampleRate / 4096;

      node.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(data);
        if (!convoRef.current) return;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        if (rms > 0.015) {
          heardSpeech = true;
          silenceFrames = 0;
        } else if (heardSpeech) {
          silenceFrames++;
          // ~1.4s of silence after speech ends the turn automatically
          if (silenceFrames > framesPerSec * 1.4) {
            node.onaudioprocess = null;
            stopRecordingRef.current();
          }
        }
      };
      src.connect(node);
      node.connect(ctx.destination);
      recRef.current = { stream, ctx, src, node, chunks };
      setRecording(true);
    } catch (e) {
      toast.error("microphone access denied");
      setConvoMode(false);
      console.error(e);
    }
  }, []);
  startRecordingRef.current = () => void startRecording();

  const stopRecording = useCallback(async () => {
    const r = recRef.current;
    if (!r) return;
    setRecording(false);
    r.node.onaudioprocess = null;
    r.stream.getTracks().forEach((t) => t.stop());
    r.node.disconnect();
    r.src.disconnect();
    const sampleRate = r.ctx.sampleRate;
    const chunks = r.chunks;
    await r.ctx.close();
    recRef.current = null;

    const blob = encodeWav(chunks, sampleRate);
    if (blob.size < 2048) {
      if (convoRef.current) {
        startRecordingRef.current();
        return;
      }
      toast.error("recording was empty — try again");
      return;
    }
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, "recording.wav");
      const res = await fetch("/api/public/stt", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const { text } = (await res.json()) as { text: string };
      if (!text?.trim()) {
        if (convoRef.current) startRecordingRef.current();
        return;
      }
      if (convoRef.current) {
        await submitText(text);
      } else {
        setInput((prev) => (prev ? prev + " " + text : text));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "transcription failed");
      setConvoMode(false);
    } finally {
      setTranscribing(false);
    }
  }, [submitText]);
  stopRecordingRef.current = () => void stopRecording();

  const toggleConvo = useCallback(() => {
    if (convoRef.current) {
      convoRef.current = false;
      setConvoMode(false);
      if (recRef.current) void stopRecording();
      toast("voice conversation off");
    } else {
      convoRef.current = true;
      setConvoMode(true);
      toast.success("voice conversation on — just start talking");
      void startRecording();
    }
  }, [startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      convoRef.current = false;
      const r = recRef.current;
      if (r) {
        r.node.onaudioprocess = null;
        r.stream.getTracks().forEach((t) => t.stop());
        void r.ctx.close();
        recRef.current = null;
      }
    };
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    await submitText(input);
  };

  const runAudit = async () => {
    if (isLoading) return;
    await submitText(
      "Run a full project audit. Review the project name, description and file list in context and report: (1) faults & bugs to repair, (2) performance upgrades, (3) security hardening, (4) UX/design improvements, (5) new features worth adding. Prioritize by impact, tag each [fix]/[perf]/[security]/[ux]/[feature], and name the files involved. Be specific and opinionated.",
    );
  };


  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12 font-mono text-sm">
            <Bot className="h-8 w-8 text-primary mx-auto mb-3" />
            <div className="text-primary">$ agent --ready</div>
            <div className="text-muted-foreground mt-2">Ask me to explain code, generate features, fix bugs, or plan a task. Tap ✦ for a full audit with suggested repairs, perf wins &amp; new features. Hold the mic to talk.</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-3">
            <div className="mt-1">
              {m.role === "user" ? (
                <User className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Bot className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-muted-foreground mb-1">
                {m.role === "user" ? "you" : "agent"}
              </div>
              <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                {m.parts.map((p, i) => {
                  if (p.type === "text") return <span key={i}>{p.text}</span>;
                  if (p.type.startsWith("tool-") || p.type === "dynamic-tool") {
                    const tp = p as unknown as { type: string; toolName?: string; state?: string; output?: unknown };
                    const name = p.type === "dynamic-tool" ? (tp.toolName ?? "tool") : p.type.slice(5);
                    const done = tp.state === "output-available";
                    const failed = tp.state === "output-error";
                    const out = tp.output as { reason?: string; appId?: string; appName?: string; ready?: boolean } | undefined;
                    return (
                      <div key={i} className="my-1 font-mono text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className={failed ? "text-destructive" : "text-primary"}>
                            {failed ? "✗" : done ? "✓" : "…"}
                          </span>
                          <span>$ {name}</span>
                          {done && name === "write_file" && (
                            <span className="text-primary/70">{out?.reason ?? "file updated"}</span>
                          )}
                          {done && name === "make_mobile_ready" && (
                            <span className="text-primary/70">android + ios scaffolding written</span>
                          )}
                        </div>
                        {done && name === "export_android_project" && out?.ready && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 font-mono text-xs"
                            disabled={exporting}
                            onClick={() => downloadAndroidZip(out.appId!, out.appName!)}
                          >
                            {exporting ? (
                              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3 mr-2" />
                            )}
                            download android studio project
                          </Button>
                        )}
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-primary font-mono text-xs">
            <Loader2 className="h-3 w-3 animate-spin" /> thinking...
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2 items-end">
          <Button
            size="icon"
            variant={recording ? "destructive" : "outline"}
            onClick={recording ? stopRecording : startRecording}
            disabled={isLoading || transcribing}
            title={recording ? "stop recording" : "hold to talk"}
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={runAudit}
            disabled={isLoading}
            title="audit project — agent suggests repairs, perf wins & features"
          >
            <Sparkles className="h-4 w-4 text-primary" />
          </Button>
          <Button
            size="icon"
            variant={voiceReply ? "default" : "outline"}
            onClick={() => setVoiceReply((v) => !v)}
            title={voiceReply ? "voice replies on" : "voice replies off"}
          >
            {voiceReply ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="ask the agent... (enter to send, shift+enter for new line)"
            className="font-mono text-sm min-h-[60px] resize-none"
            disabled={isLoading}
          />
          {isLoading ? (
            <Button size="icon" variant="destructive" onClick={() => stop()}>
              <StopCircle className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={handleSend} disabled={!input.trim()} className="hover:glow">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="mt-2 font-mono text-[10px] text-muted-foreground">
          model: <span className="text-primary">{model}</span> · session: {sessionId ? sessionId.slice(0, 8) : "new"} · {recording ? <span className="text-destructive">● rec</span> : "mic idle"} · voice: {voiceReply ? "on" : "off"}
        </div>
      </div>
    </div>
  );
}
