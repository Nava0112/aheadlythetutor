import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { startDiagnostic, completeOnboarding } from "@/lib/tutor.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

type Question = { id: string; prompt: string; skill: string };

function Onboarding() {
  const navigate = useNavigate();
  const begin = useServerFn(startDiagnostic);
  const finish = useServerFn(completeOnboarding);

  const [subject, setSubject] = useState("");
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState("beginner");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function startStep(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await begin({ data: { subject, goal, level } });
      setQuestions(res.questions);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the diagnostic");
    } finally {
      setBusy(false);
    }
  }

  async function finishStep() {
    if (!questions) return;
    setBusy(true);
    try {
      const res = await finish({
        data: {
          subject,
          goal,
          level,
          answers: questions.map((q) => ({
            prompt: q.prompt,
            skill: q.skill,
            answer: answers[q.id] ?? "",
          })),
        },
      });
      if (res.conceptId) {
        navigate({ to: "/learn/$conceptId", params: { conceptId: res.conceptId } });
      } else {
        navigate({ to: "/path" });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build your path");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      {!questions ? (
        <div className="max-w-lg">
          <h1 className="text-4xl">What do you want to learn?</h1>
          <p className="mt-3 text-muted-foreground">
            Your tutor uses this to choose questions and pitch the difficulty.
          </p>
          <form onSubmit={startStep} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="Linear algebra, Spanish grammar, Python…"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal">Your goal</Label>
              <Textarea
                id="goal"
                placeholder="Pass my exam in June and actually understand eigenvectors"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Where you'd place yourself</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Writing your questions…" : "Start the diagnostic"}
            </Button>
          </form>
        </div>
      ) : (
        <div className="max-w-2xl">
          <h1 className="text-4xl">Four questions</h1>
          <p className="mt-3 text-muted-foreground">
            Answer in your own words. A blank answer is fine — it just tells the tutor to start
            there.
          </p>
          <div className="mt-8 space-y-6">
            {questions.map((q, i) => (
              <div key={q.id} className="rounded-xl border border-border bg-card p-5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Question {i + 1} · {q.skill}
                </p>
                <p className="mt-2 text-lg">{q.prompt}</p>
                <Textarea
                  className="mt-3"
                  rows={3}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <Button className="mt-8" size="lg" onClick={finishStep} disabled={busy}>
            {busy ? "Designing your path…" : "Build my learning path"}
          </Button>
        </div>
      )}
    </AppShell>
  );
}
