/**
 * Dynamic schedule adaptation.
 *
 * Turns live evidence (tutoring chat signals, check/test analysis) into
 * concrete changes to the student's learning path: skipping what they already
 * know, inserting remediation or stretch concepts, dropping redundant material
 * and retuning difficulty. Every change is logged so the student can see why
 * their schedule moved.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { adaptLearningPath, analyzeChatSignals, type ChatSignals } from "./agents.server";
import { pickModel } from "./groq.server";

type ConceptRow = {
  id: string;
  path_id: string;
  title: string;
  summary: string;
  order_index: number;
  difficulty: string;
  status: string;
};

type ConceptWithMastery = ConceptRow & { mastery: number; attempts: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

function matchConcept(concepts: ConceptWithMastery[], title: string): ConceptWithMastery | undefined {
  const t = norm(title);
  if (!t) return undefined;
  return (
    concepts.find((c) => norm(c.title) === t) ??
    concepts.find((c) => norm(c.title).includes(t) || t.includes(norm(c.title)))
  );
}

async function loadConcepts(
  supabase: SupabaseClient,
  userId: string,
  pathId: string,
): Promise<ConceptWithMastery[]> {
  const [{ data: concepts }, { data: mastery }] = await Promise.all([
    supabase
      .from("path_concepts")
      .select("*")
      .eq("path_id", pathId)
      .order("order_index", { ascending: true }),
    supabase.from("concept_mastery").select("*").eq("user_id", userId),
  ]);
  const byConcept = new Map((mastery ?? []).map((m) => [m.concept_id, m]));
  return (concepts ?? []).map((c: ConceptRow) => ({
    ...c,
    mastery: Number(byConcept.get(c.id)?.score ?? 0),
    attempts: byConcept.get(c.id)?.attempts ?? 0,
  }));
}

/** Rewrites the stored order (0..n-1) after inserts or removals. */
async function resequence(supabase: SupabaseClient, concepts: ConceptWithMastery[]) {
  const ordered = [...concepts].sort((a, b) => a.order_index - b.order_index);
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i].order_index !== i) {
      await supabase.from("path_concepts").update({ order_index: i }).eq("id", ordered[i].id);
      ordered[i].order_index = i;
    }
  }
  return ordered;
}

/** Keeps exactly one "current" concept and points the tutor state at it. */
async function refreshCurrent(
  supabase: SupabaseClient,
  userId: string,
  pathId: string,
  concepts: ConceptWithMastery[],
): Promise<string | null> {
  const ordered = [...concepts].sort((a, b) => a.order_index - b.order_index);
  const { data: state } = await supabase
    .from("tutor_state")
    .select("current_concept_id")
    .eq("user_id", userId)
    .maybeSingle();

  const currentId = state?.current_concept_id ?? null;
  const currentStillValid =
    currentId &&
    ordered.some((c) => c.id === currentId && c.status !== "mastered" && c.status !== "removed");

  if (currentStillValid) return currentId;

  const next = ordered.find((c) => c.status !== "mastered");
  if (next) {
    if (next.status === "locked") {
      await supabase.from("path_concepts").update({ status: "current" }).eq("id", next.id);
      next.status = "current";
    }
    await supabase
      .from("tutor_state")
      .upsert({ user_id: userId, path_id: pathId, current_concept_id: next.id });
    return next.id;
  }
  return null;
}

/**
 * Applies a Curriculum Designer review to the live path.
 * Returns the student-facing explanation of what changed (empty if nothing did).
 */
export async function applyPathAdaptation(input: {
  supabase: SupabaseClient;
  userId: string;
  pathId: string;
  trigger: "chat" | "check";
  evidence: string;
  struggleStreak: number;
  teachingStyle: string;
  mastery: number;
}): Promise<{ changed: boolean; notes: string[] }> {
  const { supabase, userId, pathId } = input;

  const [{ data: path }, concepts] = await Promise.all([
    supabase.from("learning_paths").select("*").eq("id", pathId).maybeSingle(),
    loadConcepts(supabase, userId, pathId),
  ]);
  if (!path || concepts.length === 0) return { changed: false, notes: [] };

  const { data: state } = await supabase
    .from("tutor_state")
    .select("current_concept_id")
    .eq("user_id", userId)
    .maybeSingle();
  const currentConcept =
    concepts.find((c) => c.id === state?.current_concept_id) ?? concepts[0];

  const designed = await adaptLearningPath({
    subject: path.subject,
    goal: path.goal,
    level: path.level,
    concepts: concepts.map((c) => ({
      title: c.title,
      summary: c.summary,
      difficulty: c.difficulty,
      status: c.status,
      mastery: c.mastery,
      attempts: c.attempts,
    })),
    currentConceptTitle: currentConcept.title,
    struggleStreak: input.struggleStreak,
    teachingStyle: input.teachingStyle,
    trigger: input.trigger,
    evidence: input.evidence,
  });

  const notes: string[] = [];
  let touched = false;

  for (const action of designed.actions) {
    const target = "conceptTitle" in action ? matchConcept(concepts, action.conceptTitle) : undefined;

    if (action.action === "skip" && target) {
      await supabase.from("path_concepts").update({ status: "mastered" }).eq("id", target.id);
      await supabase.from("concept_mastery").upsert(
        {
          user_id: userId,
          concept_id: target.id,
          score: Math.max(0.85, target.mastery),
        },
        { onConflict: "user_id,concept_id" },
      );
      target.status = "mastered";
      target.mastery = Math.max(0.85, target.mastery);
      touched = true;
      notes.push(`Marked "${target.title}" as already covered — skipping ahead.`);
    } else if (action.action === "remove" && target) {
      await supabase.from("path_concepts").delete().eq("id", target.id);
      concepts.splice(concepts.indexOf(target), 1);
      touched = true;
      notes.push(`Dropped "${target.title}" — ${action.reason}.`);
    } else if (action.action === "insertAfter" && action.concept?.title) {
      const after = matchConcept(concepts, action.afterConceptTitle) ?? currentConcept;
      const inserted = await supabase
        .from("path_concepts")
        .insert({
          path_id: pathId,
          user_id: userId,
          title: String(action.concept.title).slice(0, 160),
          summary: String(action.concept.summary ?? "").slice(0, 500),
          order_index: after.order_index + 0.5,
          prerequisites: [],
          difficulty: ["easy", "medium", "hard"].includes(action.concept.difficulty)
            ? action.concept.difficulty
            : "medium",
          status: "locked",
        })
        .select("*")
        .maybeSingle();
      if (inserted.data) {
        concepts.push({
          ...(inserted.data as ConceptRow),
          mastery: 0,
          attempts: 0,
        });
        touched = true;
        notes.push(`Added "${action.concept.title}" after "${after.title}" — ${action.reason}.`);
      }
    } else if (action.action === "retune" && target) {
      const patch: Record<string, string> = {};
      if (action.newTitle) patch.title = String(action.newTitle).slice(0, 160);
      if (action.newSummary) patch.summary = String(action.newSummary).slice(0, 500);
      if (
        action.newDifficulty &&
        ["easy", "medium", "hard"].includes(action.newDifficulty)
      ) {
        patch.difficulty = action.newDifficulty;
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from("path_concepts").update(patch).eq("id", target.id);
        Object.assign(target, patch);
        touched = true;
        notes.push(`Adjusted "${target.title}" — ${action.reason}.`);
      }
    }
  }

  if (!touched) {
    // Level may still have been re-estimated even with no structural change.
    if (designed.level !== path.level) {
      await supabase.from("learning_paths").update({ level: designed.level }).eq("id", pathId);
    }
    return { changed: false, notes: [] };
  }

  const ordered = await resequence(supabase, concepts);
  await refreshCurrent(supabase, userId, pathId, ordered);
  if (designed.level !== path.level) {
    await supabase.from("learning_paths").update({ level: designed.level }).eq("id", pathId);
  }

  const detail = notes.join(" ");
  await supabase.from("path_adjustments").insert({
    user_id: userId,
    path_id: pathId,
    trigger: input.trigger,
    reason: input.evidence.slice(0, 300),
    detail: detail.slice(0, 1000),
  });

  return { changed: true, notes };
}

/**
 * Chat-driven adaptation: after every 4th student message in a concept
 * conversation, analyse the chat for progress signals, nudge the mastery
 * estimate, and re-plan the schedule when the student is stuck or racing ahead.
 */
export async function adaptAfterChat(input: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  conceptId: string;
  conceptTitle: string;
  conceptSummary: string;
  pathId: string;
  subject: string;
  pathGoal: string;
  struggleStreak: number;
  teachingStyle: string;
  mastery: number;
}): Promise<{ note: string | null; signals: ChatSignals | null }> {
  const { supabase, userId } = input;

  const { count } = await supabase
    .from("tutor_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", input.sessionId)
    .eq("role", "user");
  if (!count || count % 4 !== 0) return { note: null, signals: null };

  const { data: recent } = await supabase
    .from("tutor_messages")
    .select("role, content")
    .eq("session_id", input.sessionId)
    .order("created_at", { ascending: false })
    .limit(10);
  const transcript = (recent ?? [])
    .reverse()
    .map((m) => `${m.role === "assistant" ? "Tutor" : "Student"}: ${m.content}`)
    .join("\n\n")
    .slice(0, 6000);

  let signals: ChatSignals;
  try {
    signals = await analyzeChatSignals({
      subject: input.subject,
      conceptTitle: input.conceptTitle,
      conceptSummary: input.conceptSummary,
      mastery: input.mastery,
      transcript,
    });
  } catch {
    return { note: null, signals: null };
  }

  if (signals.masteryDelta !== 0) {
    const { data: existing } = await supabase
      .from("concept_mastery")
      .select("score")
      .eq("user_id", userId)
      .eq("concept_id", input.conceptId)
      .maybeSingle();
    const next = Math.min(0.95, Math.max(0, Number(existing?.score ?? input.mastery) + signals.masteryDelta));
    await supabase.from("concept_mastery").upsert(
      { user_id: userId, concept_id: input.conceptId, score: next },
      { onConflict: "user_id,concept_id" },
    );
  }

  if (!signals.stuck && !signals.ahead) {
    return { note: null, signals };
  }

  const evidence = `${input.subject} conversation review: ${signals.note || (signals.stuck ? "the student appears stuck" : "the student is ahead of the plan")}`;
  try {
    const result = await applyPathAdaptation({
      supabase,
      userId,
      pathId: input.pathId,
      trigger: "chat",
      evidence,
      struggleStreak: input.struggleStreak,
      teachingStyle: input.teachingStyle,
      mastery: input.mastery,
    });
    return { note: result.changed ? result.notes.join(" ") : null, signals };
  } catch {
    return { note: null, signals };
  }
}
