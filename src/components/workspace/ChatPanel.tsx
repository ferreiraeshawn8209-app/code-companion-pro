import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Bot, User, StopCircle } from "lucide-react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentSessionRef = useRef<string | null>(sessionId);
  currentSessionRef.current = sessionId;

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    id: sessionId ?? "pending",
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: {
        model,
        projectContext: {
          name: projectName,
          description: projectDescription ?? undefined,
          files: files.map((f) => ({ path: f.path })),
        },
      },
    }),
    onError: (err) => toast.error(err.message ?? "chat error"),
    onFinish: async ({ message }) => {
      // Persist the assistant message
      const sid = currentSessionRef.current;
      if (!sid) return;
      const { error } = await supabase.from("ai_messages").insert({
        session_id: sid,
        role: "assistant",
        parts: message.parts,
      });
      if (error) console.error("persist assistant:", error);
    },
  });

  useEffect(() => {
    setMessages(initialMessages);
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const isLoading = status === "submitted" || status === "streaming";

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

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

    // Persist user message
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
      metadata: { model, prompt_length: trimmed.length },
      user_id: (await supabase.auth.getUser()).data.user?.id,
    });

    setInput("");
    sendMessage({ text: trimmed });
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12 font-mono text-sm">
            <Bot className="h-8 w-8 text-primary mx-auto mb-3" />
            <div className="text-primary">$ agent --ready</div>
            <div className="text-muted-foreground mt-2">Ask me to explain code, generate features, fix bugs, or plan a task.</div>
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
                {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
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
          model: <span className="text-primary">{model}</span> · session: {sessionId ? sessionId.slice(0, 8) : "new"}
        </div>
      </div>
    </div>
  );
}
