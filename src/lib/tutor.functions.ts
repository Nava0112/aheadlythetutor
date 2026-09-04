import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MASTERY_THRESHOLD = 0.8;

/** Loads (or creates) the student's progress state plus their active path. */
export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    let { data: state } = await supabase
      .from("tutor_state")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!state) {
      const inserted = await supabase
        .from("tutor_state")
        .insert({ user_id: userId })
        .select("*")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      state = inserted.data;
    }

    const { data: path } = await supabase
      .from("learning_paths")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!path) {
      return { state, path: null, concepts: [] as ConceptWithMastery[] };
    }

    const [{ data: concepts }, { data: mastery }] = await Promise.all([
      supabase
        .from("path_concepts")
        .select("*")
        .eq("path_id", path.id)
        .order("order_index", { ascending: true }),
      supabase.from("concept_mastery").select("*").eq("user_id", userId),
    ]);

    const byConcept = new Map((mastery ?? []).map((m) => [m.concept_id, m]));
    const withMastery: ConceptWithMastery[] = (concepts ?? []).map((c) => ({
      ...c,
      mastery: Number(byConcept.get(c.id)?.score ?? 0),
      attempts: byConcept.get(c.id)?.attempts ?? 0,
    }));

    return { state, path, concepts: withMastery };
  });

export type ConceptWithMastery = {
  id: string;
  path_id: string;
  title: string;
  summary: string;
  order_index: number;
  prerequisites: string[];
  difficulty: string;
  status: string;
  mastery: number;
  attempts: number;
};

/** Assessment Proctor: diagnostic questions before the path is designed. */
export const startDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ subject: z.string().min(1), goal: z.string().min(1), level: z.string().min(1) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { generateDiagnostic } = await import("./agents.server");
    const questions = await generateDiagnostic(data);
    return { questions };
  });

/** Curriculum Designer: build and persist the personalised path. */
export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        subject: z.string().min(1),
        goal: z.string().min(1),
        level: z.string().min(1),
        answers: z.array(
          z.object({ prompt: z.string(), skill: z.string(), answer: z.string() }),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { generateLearningPath } = await import("./agents.server");

    const designed = await generateLearningPath(data);
    if (designed.concepts.length === 0) {
      throw new Error("The curriculum designer could not build a path. Please try again.");
    }

    await supabase
      .from("learning_paths")
      .update({ status: "archived" })
      .eq("user_id", userId)
      .eq("status", "active");

    const pathInsert = await supabase
      .from("learning_paths")
      .insert({
        user_id: userId,
        subject: data.subject,
        goal: data.goal,
        level: designed.level,
        status: "active",
      })
      .select("*")
      .single();
    if (pathInsert.error) throw new Error(pathInsert.error.message);
    const path = pathInsert.data;

    let firstOpen: string | null = null;
    const rows = designed.concepts.map((c, index) => {
      const mastered = c.estimatedMastery >= MASTERY_THRESHOLD;
      const status = mastered ? "mastered" : firstOpen === null ? "current" : "locked";
      if (!mastered && firstOpen === null) firstOpen = "pending";
      return {
        path_id: path.id,
        user_id: userId,
        title: c.title,
        summary: c.summary,
        order_index: index,
        prerequisites: c.prerequisites,
        difficulty: c.difficulty,
        status,
        estimated: c.estimatedMastery,
      };
    });

    const conceptInsert = await supabase
      .from("path_concepts")
      .insert(rows.map(({ estimated: _estimated, ...row }) => row))
      .select("*");
    if (conceptInsert.error) throw new Error(conceptInsert.error.message);

    const masteryRows = conceptInsert.data.map((c, index) => ({
      user_id: userId,
      concept_id: c.id,
      score: rows[index]?.estimated ?? 0,
      attempts: 0,
    }));
    const masteryInsert = await supabase.from("concept_mastery").insert(masteryRows);
    if (masteryInsert.error) throw new Error(masteryInsert.error.message);

    const current = conceptInsert.data.find((c) => c.status === "current") ?? conceptInsert.data[0];

    const stateUpdate = await supabase.from("tutor_state").upsert({
      user_id: userId,
      path_id: path.id,
      current_concept_id: current?.id ?? null,
      phase: "tutoring",
      struggle_streak: 0,
      teaching_style: "socratic",
    });
    if (stateUpdate.error) throw new Error(stateUpdate.error.message);

    return { pathId: path.id, conceptId: current?.id ?? null };
  });

/** Opens (or resumes) the tutoring session for one concept. */
export const getConceptWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conceptId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: concept, error } = await supabase
      .from("path_concepts")
      .select("*")
      .eq("id", data.conceptId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!concept) throw new Error("That concept could not be found.");

    const { data: path } = await supabase
      .from("learning_paths")
      .select("*")
      .eq("id", concept.path_id)
      .maybeSingle();

    let { data: session } = await supabase
      .from("tutor_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("concept_id", concept.id)
      .eq("kind", "tutoring")
      .maybeSingle();

    if (!session) {
      const created = await supabase
        .from("tutor_sessions")
        .insert({
          user_id: userId,
          path_id: concept.path_id,
          concept_id: concept.id,
          kind: "tutoring",
          title: concept.title,
        })
        .select("*")
        .single();
      if (created.error) throw new Error(created.error.message);
      session = created.data;
    }

    const [{ data: messages }, { data: mastery }] = await Promise.all([
      supabase
        .from("tutor_messages")
        .select("id, role, content, created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("concept_mastery")
        .select("*")
        .eq("user_id", userId)
        .eq("concept_id", concept.id)
        .maybeSingle(),
    ]);

    return {
      concept,
      path,
      session,
      messages: messages ?? [],
      mastery: Number(mastery?.score ?? 0),
      attempts: mastery?.attempts ?? 0,
    };
  });

/** Practice Problem Generator: the end-of-concept check. */
export const startCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conceptId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { generateCheck } = await import("./agents.server");

    const { data: concept } = await supabase
      .from("path_concepts")
      .select("*, learning_paths(subject)")
      .eq("id", data.conceptId)
      .maybeSingle();
    if (!concept) throw new Error("That concept could not be found.");

    const subject =
      (concept as { learning_paths?: { subject?: string } }).learning_paths?.subject ?? "general studies";

    const questions = await generateCheck({
      subject,
      conceptTitle: concept.title,
      conceptSummary: concept.summary,
      difficulty: concept.difficulty,
    });
    return { questions };
  });

/**
 * Performance Analyst + progression logic. Grades the check, updates mastery
 * and moves the state machine: advance, remediate, or change teaching style.
 */
export const submitCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conceptId: z.string().uuid(),
        answers: z.array(
          z.object({ prompt: z.string(), expected: z.string(), answer: z.string() }),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { gradeCheck } = await import("./agents.server");

    const { data: concept } = await supabase
      .from("path_concepts")
      .select("*, learning_paths(subject)")
      .eq("id", data.conceptId)
      .maybeSingle();
    if (!concept) throw new Error("That concept could not be found.");

    const subject =
      (concept as { learning_paths?: { subject?: string } }).learning_paths?.subject ?? "general studies";

    const grade = await gradeCheck({
      subject,
      conceptTitle: concept.title,
      answers: data.answers,
    });

    const { data: existing } = await supabase
      .from("concept_mastery")
      .select("*")
      .eq("user_id", userId)
      .eq("concept_id", concept.id)
      .maybeSingle();

    const previous = Number(existing?.score ?? 0);
    // Weighted update so one strong answer doesn't instantly mark mastery.
    const nextScore = Math.min(1, Math.max(0, previous * 0.35 + grade.score * 0.65));
    const attempts = (existing?.attempts ?? 0) + 1;

    await supabase.from("concept_mastery").upsert(
      {
        user_id: userId,
        concept_id: concept.id,
        score: nextScore,
        attempts,
        last_reviewed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,concept_id" },
    );

    const { data: state } = await supabase
      .from("tutor_state")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const mastered = nextScore >= MASTERY_THRESHOLD;
    const improved = nextScore - previous > 0.05;
    let struggleStreak = state?.struggle_streak ?? 0;
    let teachingStyle = state?.teaching_style ?? "socratic";
    let outcome: "advanced" | "remediate" | "recalibrated" = "remediate";
    let nextConceptId: string | null = null;

    if (mastered) {
      // Branch: mastery demonstrated -> advance to the next concept.
      outcome = "advanced";
      struggleStreak = 0;
      teachingStyle = "socratic";
      await supabase.from("path_concepts").update({ status: "mastered" }).eq("id", concept.id);

      const { data: next } = await supabase
        .from("path_concepts")
        .select("*")
        .eq("path_id", concept.path_id)
        .neq("status", "mastered")
        .gt("order_index", concept.order_index)
        .order("order_index", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (next) {
        nextConceptId = next.id;
        await supabase.from("path_concepts").update({ status: "current" }).eq("id", next.id);
      }
    } else {
      struggleStreak += 1;
      await supabase.from("path_concepts").update({ status: "current" }).eq("id", concept.id);

      if (struggleStreak >= 2 && !improved) {
        // Branch: plateau -> change pedagogical approach.
        outcome = "recalibrated";
        teachingStyle =
          teachingStyle === "socratic"
            ? "worked-examples"
            : teachingStyle === "worked-examples"
              ? "concrete"
              : "socratic";
      }
    }

    await supabase.from("tutor_state").upsert({
      user_id: userId,
      path_id: concept.path_id,
      current_concept_id: nextConceptId ?? concept.id,
      phase: nextConceptId ? "tutoring" : mastered ? "review" : "remediation",
      struggle_streak: struggleStreak,
      teaching_style: teachingStyle,
    });

    // Keep the review in the conversation so the session resumes with context.
    const { data: session } = await supabase
      .from("tutor_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("concept_id", concept.id)
      .eq("kind", "tutoring")
      .maybeSingle();

    if (session) {
      await supabase.from("tutor_messages").insert({
        session_id: session.id,
        user_id: userId,
        role: "assistant",
        content: `Check review — score ${Math.round(grade.score * 100)}%. ${grade.feedback}`,
      });
    }

    return {
      grade,
      mastery: nextScore,
      outcome,
      nextConceptId,
      teachingStyle,
      struggleStreak,
    };
  });
