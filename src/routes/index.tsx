import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Socratic — a tutor that teaches only you" },
      {
        name: "description",
        content:
          "Answer a few diagnostic questions, get a learning path built for what you actually know, then learn one concept at a time in conversation.",
      },
      { property: "og:title", content: "Socratic — a tutor that teaches only you" },
      {
        property: "og:description",
        content: "Diagnostic, personal learning path, and one-to-one tutoring conversations.",
      },
    ],
  }),
  component: Index,
});

const steps = [
  {
    n: "01",
    title: "A short diagnostic",
    body: "Four questions work out what you already know, so nothing you've mastered gets taught again.",
  },
  {
    n: "02",
    title: "Your own path",
    body: "A curriculum designer orders the concepts you actually need, with prerequisites first.",
  },
  {
    n: "03",
    title: "Learn by talking",
    body: "One concept at a time, guided by questions rather than lectures. Every session picks up where you left it.",
  },
  {
    n: "04",
    title: "Checks that adapt",
    body: "Short checks update your mastery. Struggle twice and the tutor changes how it teaches.",
  },
];

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-display text-2xl">Socratic</span>
        <Button asChild variant="ghost">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 pb-20 pt-14">
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            One student. One path.
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl leading-[1.05] sm:text-7xl">
            A tutor that finds out what you know before it teaches you anything.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Pick a subject and a goal. Socratic assesses you, designs a path through the concepts
            you're missing, and teaches each one in conversation — asking, hinting, and only then
            explaining.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Start learning</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth">I already have an account</Link>
            </Button>
          </div>
        </section>

        <section className="border-y border-border bg-card">
          <div className="mx-auto grid max-w-5xl gap-px px-6 py-16 sm:grid-cols-2">
            {steps.map((s) => (
              <div key={s.n} className="p-6">
                <span className="font-display text-3xl text-primary">{s.n}</span>
                <h2 className="mt-3 text-2xl">{s.title}</h2>
                <p className="mt-2 text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-20">
          <blockquote className="max-w-2xl font-display text-3xl italic leading-snug sm:text-4xl">
            “What's the smallest change you could make to that expression so both sides balance?”
          </blockquote>
          <p className="mt-4 text-muted-foreground">
            A hint before an answer, every time. That's the whole method.
          </p>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-8 text-center text-sm text-muted-foreground">
        Socratic — personal tutoring, one concept at a time.
      </footer>
    </div>
  );
}
