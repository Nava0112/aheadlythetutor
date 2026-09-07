import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOverview } from "@/lib/tutor.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/path")({
  component: PathPage,
});

function PathPage() {
  const navigate = useNavigate();
  const fetchOverview = useServerFn(getOverview);
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: () => fetchOverview({}),
  });

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-muted-foreground">Loading your path…</p>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <p className="text-destructive">{(error as Error).message}</p>
      </AppShell>
    );
  }

  if (!data?.path) {
    return (
      <AppShell>
        <h1 className="text-4xl">Let's find out what you know</h1>
        <p className="mt-3 max-w-lg text-muted-foreground">
          Choose a subject and a goal, answer four short questions, and your tutor will design a
          path around the gaps.
        </p>
        <Button className="mt-7" size="lg" onClick={() => navigate({ to: "/onboarding" })}>
          Start the diagnostic
        </Button>
      </AppShell>
    );
  }

  const concepts = data.concepts;
  const mastered = concepts.filter((c) => c.status === "mastered").length;
  const overall = concepts.length ? Math.round((mastered / concepts.length) * 100) : 0;

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            {data.path.subject}
          </p>
          <h1 className="mt-2 max-w-2xl text-4xl">{data.path.goal}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Level {data.path.level} · teaching style: {data.state?.teaching_style ?? "socratic"}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/onboarding" })}>
          Start a new path
        </Button>
      </div>

      <div className="mt-8">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>
            {mastered} of {concepts.length} concepts mastered
          </span>
          <span>{overall}%</span>
        </div>
        <Progress value={overall} className="mt-2" />
      </div>

      <ol className="mt-10 space-y-3">
        {concepts.map((c, i) => {
          const locked = c.status === "locked";
          return (
            <li
              key={c.id}
              className={`rounded-xl border border-border bg-card p-5 ${locked ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-xl">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-2xl text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h2 className="text-2xl">{c.title}</h2>
                  </div>
                  <p className="mt-2 text-muted-foreground">{c.summary}</p>
                  <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
                    {c.status} · {c.difficulty} · mastery {Math.round(c.mastery * 100)}%
                  </p>
                </div>
                <Button asChild variant={c.status === "current" ? "default" : "outline"}>
                  <Link to="/learn/$conceptId" params={{ conceptId: c.id }}>
                    {c.status === "mastered" ? "Revisit" : locked ? "Preview" : "Continue"}
                  </Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </AppShell>
  );
}
