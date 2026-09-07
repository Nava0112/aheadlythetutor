import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserFromRequest } = await import("@/lib/auth.server");
        const auth = await getUserFromRequest(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });
        const { supabase, userId } = auth;

        let body: { conceptId?: string; message?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const conceptId = String(body.conceptId ?? "");
        const message = String(body.message ?? "").trim();
        if (!conceptId || !message) return new Response("Bad request", { status: 400 });

        const { data: concept } = await supabase
          .from("path_concepts")
          .select("*, learning_paths(subject, goal)")
          .eq("id", conceptId)
          .maybeSingle();
        if (!concept) return new Response("Concept not found", { status: 404 });

        const path = (concept as { learning_paths?: { subject?: string; goal?: string } })
          .learning_paths;

        const { data: session } = await supabase
          .from("tutor_sessions")
          .select("id")
          .eq("user_id", userId)
          .eq("concept_id", conceptId)
          .eq("kind", "tutoring")
          .maybeSingle();
        if (!session) return new Response("Session not found", { status: 404 });

        const [{ data: history }, { data: state }, { data: mastery }] = await Promise.all([
          supabase
            .from("tutor_messages")
            .select("role, content")
            .eq("session_id", session.id)
            .order("created_at", { ascending: true })
            .limit(40),
          supabase.from("tutor_state").select("*").eq("user_id", userId).maybeSingle(),
          supabase
            .from("concept_mastery")
            .select("score")
            .eq("user_id", userId)
            .eq("concept_id", conceptId)
            .maybeSingle(),
        ]);

        await supabase
          .from("tutor_messages")
          .insert({ session_id: session.id, user_id: userId, role: "user", content: message });

        const { tutorSystemPrompt } = await import("@/lib/agents.server");
        const { deepseekStream, pickModel } = await import("@/lib/deepseek.server");

        const subject = path?.subject ?? "general studies";
        const system = tutorSystemPrompt({
          subject,
          goal: path?.goal ?? "learn this subject",
          conceptTitle: concept.title,
          conceptSummary: concept.summary ?? "",
          style: state?.teaching_style ?? "socratic",
          struggleStreak: state?.struggle_streak ?? 0,
          mastery: Number(mastery?.score ?? 0),
        });

        const messages = [
          { role: "system" as const, content: system },
          ...(history ?? []).map((m) => ({
            role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
            content: m.content as string,
          })),
          { role: "user" as const, content: message },
        ];

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let full = "";
            try {
              for await (const chunk of deepseekStream({
                model: pickModel(subject),
                temperature: 0.6,
                messages,
              })) {
                full += chunk;
                controller.enqueue(encoder.encode(chunk));
              }
            } catch (error) {
              const text =
                error instanceof Error ? error.message : "The tutor is unavailable right now.";
              full = full || text;
              controller.enqueue(encoder.encode(full ? `\n\n${text}` : text));
            }
            if (full.trim()) {
              await supabase.from("tutor_messages").insert({
                session_id: session.id,
                user_id: userId,
                role: "assistant",
                content: full,
              });
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
