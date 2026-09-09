import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getConceptWorkspace, startCheck, submitCheck } from "@/lib/tutor.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/learn/$conceptId")({
  component: LearnPage,
});

type Msg = { id: string; role: string; content: string };
type CheckQuestion = { prompt: string; expected: string };

function LearnPage() {
  const { conceptId } = Route.useParams();
  const navigate = useNavigate();
  const loadWorkspace = useServerFn(getConceptWorkspace);
  const beginCheck = useServerFn(startCheck);
  const sendCheck = useServerFn(submitCheck);

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace", conceptId],
    queryFn: () => loadWorkspace({ data: { conceptId } }),
  });

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [questions, setQuestions] = useState<CheckQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [mastery, setMastery] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (data) {
      setMessages(data.messages as Msg[]);
      setMastery(data.mastery);
    }
  }, [data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: text }]);
    setStreaming(true);
    setDraft("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conceptId, message: text }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setDraft(full);
      }
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: full }]);
      setDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The tutor didn't reply");
    } finally {
      setStreaming(false);
    }
  }

  async function openCheck() {
    setBusy(true);
    try {
      const res = await beginCheck({ data: { conceptId } });
      setQuestions(res.questions);
      setAnswers({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the check");
    } finally {
      setBusy(false);
    }
  }

  async function finishCheck() {
    if (!questions) return;
    setBusy(true);
    try {
      const res = await sendCheck({
        data: {
          conceptId,
          answers: questions.map((q, i) => ({
            prompt: q.prompt,
            expected: q.expected,
            answer: answers[i] ?? "",
          })),
        },
      });
      setQuestions(null);
      setMastery(res.mastery);
      setMessages((m) => [
        ...m,
        {
          id: `g-${Date.now()}`,
          role: "assistant",
          content: `Check review — score ${Math.round(res.grade.score * 100)}%. ${res.grade.feedback}`,
        },
      ]);
      if (res.outcome === "advanced") {
        toast.success("Concept mastered — moving on");
        if (res.nextConceptId) {
          navigate({ to: "/learn/$conceptId", params: { conceptId: res.nextConceptId } });
        } else {
          navigate({ to: "/path" });
        }
      } else if (res.outcome === "recalibrated") {
        toast(`Switching approach: ${res.teachingStyle}`);
      } else {
        toast("Let's work on this a bit more");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not grade the check");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-muted-foreground">Opening your session…</p>
      </AppShell>
    );
  }
  if (error || !data) {
    return (
      <AppShell>
        <p className="text-destructive">{(error as Error)?.message ?? "Concept not found"}</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/path" className="text-sm text-muted-foreground underline underline-offset-4">
            ← Back to my path
          </Link>
          <h1 className="mt-2 text-4xl">{data.concept.title}</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">{data.concept.summary}</p>
        </div>
        <div className="w-48">
          <p className="text-sm text-muted-foreground">Mastery {Math.round(mastery * 100)}%</p>
          <Progress value={mastery * 100} className="mt-2" />
        </div>
      </div>

      {questions ? (
        <div className="mt-8 max-w-2xl">
          <h2 className="text-2xl">Quick check</h2>
          <div className="mt-4 space-y-4">
            {questions.map((q, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5">
                <p className="text-lg">{q.prompt}</p>
                <Textarea
                  rows={3}
                  className="mt-3"
                  value={answers[i] ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <Button onClick={finishCheck} disabled={busy}>
              {busy ? "Marking…" : "Submit check"}
            </Button>
            <Button variant="ghost" onClick={() => setQuestions(null)} disabled={busy}>
              Back to the lesson
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8 space-y-4">
            {messages.length === 0 && (
              <p className="text-muted-foreground">
                Say hello, or ask your first question — the tutor will start with a question of its
                own.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-xl rounded-2xl bg-primary px-4 py-3 text-primary-foreground"
                    : "max-w-2xl rounded-2xl border border-border bg-card px-4 py-3"
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              </div>
            ))}
            {draft && (
              <div className="max-w-2xl rounded-2xl border border-border bg-card px-4 py-3">
                <p className="whitespace-pre-wrap leading-relaxed">{draft}</p>
              </div>
            )}
            {streaming && !draft && <p className="text-muted-foreground">Thinking…</p>}
            <div ref={endRef} />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Textarea
              rows={2}
              placeholder="Type your answer or question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex gap-2">
              <Button onClick={() => void send()} disabled={streaming}>
                Send
              </Button>
              <Button variant="outline" onClick={openCheck} disabled={busy || streaming}>
                {busy ? "…" : "Check my understanding"}
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
