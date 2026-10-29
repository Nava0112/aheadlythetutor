/**
 * Specialised tutor agents. Each agent is a prompt + output contract that runs
 * on top of the Groq client.
 */
import { groqJson, pickModel, type ChatMessage } from "./groq.server";

export type DiagnosticQuestion = {
  id: string;
  prompt: string;
  skill: string;
  type: "mcq" | "open";
  options: string[];
  correctIndex: number | null;
};

export type GeneratedConcept = {
  title: string;
  summary: string;
  difficulty: "easy" | "medium" | "hard";
  prerequisites: string[];
  estimatedMastery: number;
};

export type CheckQuestion = {
  prompt: string;
  expected: string;
  type: "mcq" | "open";
  options: string[];
  correctIndex: number | null;
};

export type CheckGrade = {
  score: number;
  verdict: "mastered" | "progressing" | "struggling";
  feedback: string;
  errorType: "careless" | "conceptual" | "knowledge-gap" | "none";
};

/** Normalises a model-produced question into a safe MCQ or open question. */
function normaliseQuestion<T extends { type?: string; options?: unknown; correctIndex?: unknown }>(
  q: T,
): { type: "mcq" | "open"; options: string[]; correctIndex: number | null } {
  const options = Array.isArray(q.options) ? q.options.map(String).filter(Boolean) : [];
  const index = Number(q.correctIndex);
  const isMcq = q.type === "mcq" && options.length >= 2 && Number.isInteger(index) && index >= 0 && index < options.length;
  return isMcq
    ? { type: "mcq", options, correctIndex: index }
    : { type: "open", options: [], correctIndex: null };
}


/** Assessment Proctor (light): a short diagnostic before the path is built. */
export async function generateDiagnostic(input: {
  subject: string;
  goal: string;
  level: string;
}): Promise<DiagnosticQuestion[]> {
  const result = await groqJson<{ questions?: DiagnosticQuestion[] }>({
    model: pickModel(input.subject),
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "You are an Assessment Proctor. You write short diagnostic entrance questions that reveal what a learner already knows. Reply with JSON only.",
      },
      {
        role: "user",
        content: `Subject: ${input.subject}
Goal: ${input.goal}
Self-reported level: ${input.level}

Write exactly 5 diagnostic questions ordered from easiest to hardest, probing distinct prerequisite skills.
Exactly 3 must be multiple choice ("mcq") with 4 plausible options and one correct option, and exactly 2 must be open response ("open").
For mcq questions give "options" (4 strings) and "correctIndex" (0-based). For open questions use "options": [] and "correctIndex": null.
Return JSON: {"questions":[{"id":"q1","prompt":"...","skill":"...","type":"mcq","options":["..."],"correctIndex":0}]}`,
      },
    ],
  });
  return (result.questions ?? []).slice(0, 5).map((q, i) => ({
    id: q.id || `q${i + 1}`,
    prompt: String(q.prompt ?? ""),
    skill: String(q.skill ?? "general"),
    ...normaliseQuestion(q),
  }));

}

/** Curriculum Designer: turns the diagnostic into an ordered learning path. */
export async function generateLearningPath(input: {
  subject: string;
  goal: string;
  level: string;
  answers: Array<{ prompt: string; skill: string; answer: string }>;
}): Promise<{ level: string; concepts: GeneratedConcept[] }> {
  const transcript = input.answers
    .map((a, i) => `Q${i + 1} (${a.skill}): ${a.prompt}\nAnswer: ${a.answer || "(no answer)"}`)
    .join("\n\n");

  const result = await groqJson<{ level?: string; concepts?: GeneratedConcept[] }>({
    model: pickModel(input.subject),
    temperature: 0.3,
    maxTokens: 3000,
    messages: [
      {
        role: "system",
        content:
          "You are a Curriculum Designer. You build tight, prerequisite-ordered learning paths for one student. Reply with JSON only.",
      },
      {
        role: "user",
        content: `Subject: ${input.subject}
Goal: ${input.goal}
Self-reported level: ${input.level}

Diagnostic responses:
${transcript}

Judge the student's real starting level, then design 6 to 9 concepts that take them from there to the goal.
Skip what they already demonstrated. estimatedMastery is 0 to 1 based on the diagnostic evidence.
Return JSON: {"level":"beginner|intermediate|advanced","concepts":[{"title":"...","summary":"one sentence","difficulty":"easy|medium|hard","prerequisites":["title of an earlier concept"],"estimatedMastery":0.0}]}`,
      },
    ],
  });

  const concepts = (result.concepts ?? []).slice(0, 10).map((c) => ({
    title: String(c.title ?? "Untitled concept"),
    summary: String(c.summary ?? ""),
    difficulty: (["easy", "medium", "hard"] as const).includes(c.difficulty) ? c.difficulty : "medium",
    prerequisites: Array.isArray(c.prerequisites) ? c.prerequisites.map(String) : [],
    estimatedMastery: Math.min(1, Math.max(0, Number(c.estimatedMastery) || 0)),
  }));

  return { level: String(result.level ?? input.level), concepts };
}

/** Interactive Tutor: the system prompt for the streaming conversation. */
export function tutorSystemPrompt(input: {
  subject: string;
  goal: string;
  conceptTitle: string;
  conceptSummary: string;
  style: string;
  struggleStreak: number;
  mastery: number;
}): string {
  const styleNote =
    input.style === "worked-examples"
      ? "The student has been struggling, so lead with a fully worked example and then ask them to imitate it."
      : input.style === "concrete"
        ? "The student has plateaued with abstractions, so teach through concrete, real-world examples and analogies first."
        : "Teach Socratically: ask one guiding question at a time and let the student do the thinking.";

  return `You are an Interactive Tutor for a student studying ${input.subject}.
Their overall goal: ${input.goal}.
Current concept: "${input.conceptTitle}" — ${input.conceptSummary}
Current mastery estimate: ${Math.round(input.mastery * 100)}%. Recent struggle streak: ${input.struggleStreak}.

${styleNote}

Rules:
- Stay on this concept. If the student drifts, connect it back.
- Keep replies short (under 150 words) and end with one question.
- Never give the final answer straight away; give a hint, then a bigger hint.
- Praise specific reasoning, correct mistakes gently and name the misconception.
- Use markdown-free plain prose with simple formatting; write maths in plain readable notation.`;
}

/** Practice Problem Generator: a formative check at the end of a concept. */
export async function generateCheck(input: {
  subject: string;
  conceptTitle: string;
  conceptSummary: string;
  difficulty: string;
}): Promise<CheckQuestion[]> {
  const result = await groqJson<{ questions?: CheckQuestion[] }>({
    model: pickModel(input.subject),
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          "You are a Practice Problem Generator. You write short formative check questions. Reply with JSON only.",
      },
      {
        role: "user",
        content: `Subject: ${input.subject}
Concept: ${input.conceptTitle} — ${input.conceptSummary}
Difficulty: ${input.difficulty}

Write exactly 4 short questions that test whether the student truly understands this concept (not recall alone).
Exactly 2 must be multiple choice ("mcq") with 4 options where the distractors reflect common misconceptions, and exactly 2 must be free response ("open").
For mcq give "options" (4 strings) and "correctIndex" (0-based); for open use "options": [] and "correctIndex": null.
"expected" holds the key points (for mcq, why the correct option is right).
Return JSON: {"questions":[{"prompt":"...","expected":"...","type":"mcq","options":["..."],"correctIndex":0}]}`,
      },
    ],
  });
  return (result.questions ?? []).slice(0, 4).map((q) => ({
    prompt: String(q.prompt ?? ""),
    expected: String(q.expected ?? ""),
    ...normaliseQuestion(q),
  }));
}

/** Performance Analyst: rubric grading of open answers, blended with MCQ accuracy. */
export async function gradeCheck(input: {
  subject: string;
  conceptTitle: string;
  open: Array<{ prompt: string; expected: string; answer: string }>;
  mcq: Array<{ prompt: string; chosen: string; correct: string; isCorrect: boolean }>;
}): Promise<CheckGrade> {
  const mcqScore = input.mcq.length
    ? input.mcq.filter((m) => m.isCorrect).length / input.mcq.length
    : null;

  const mcqTranscript = input.mcq
    .map(
      (m, i) =>
        `MCQ${i + 1}: ${m.prompt}\nChose: ${m.chosen || "(no answer)"}\nCorrect: ${m.correct}\nResult: ${m.isCorrect ? "correct" : "incorrect"}`,
    )
    .join("\n\n");

  const openTranscript = input.open
    .map(
      (a, i) =>
        `Q${i + 1}: ${a.prompt}\nExpected key points: ${a.expected}\nStudent answer: ${a.answer || "(blank)"}`,
    )
    .join("\n\n");

  const result = await groqJson<Partial<CheckGrade>>({
    model: pickModel(input.subject),
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a Performance Analyst grading against a rubric. You are fair but not generous. Reply with JSON only.",
      },
      {
        role: "user",
        content: `Concept: ${input.conceptTitle}

Multiple choice results:
${mcqTranscript || "(none)"}

Written answers:
${openTranscript || "(none)"}

Grade the written answers from 0 to 1 in "score". Classify the dominant error type across everything, and write feedback that refers to both the multiple choice results and the written answers.
Return JSON: {"score":0.0,"verdict":"mastered|progressing|struggling","feedback":"2-3 sentences addressed to the student","errorType":"careless|conceptual|knowledge-gap|none"}`,
      },
    ],
  });

  const openScore = Math.min(1, Math.max(0, Number(result.score) || 0));
  const score =
    mcqScore === null
      ? openScore
      : input.open.length === 0
        ? mcqScore
        : mcqScore * 0.4 + openScore * 0.6;

  const verdict: CheckGrade["verdict"] =
    score >= 0.8 ? "mastered" : score >= 0.5 ? "progressing" : "struggling";

  return {
    score,
    verdict,
    feedback: String(result.feedback ?? "Keep going — review the concept and try again."),
    errorType:
      result.errorType === "careless" ||
      result.errorType === "conceptual" ||
      result.errorType === "knowledge-gap"
        ? result.errorType
        : "none",
  };
}


/** Conversation Analyst: reads the live tutoring chat for progress signals. */
export type ChatSignals = {
  masteryDelta: number;
  stuck: boolean;
  ahead: boolean;
  note: string;
};

export async function analyzeChatSignals(input: {
  subject: string;
  conceptTitle: string;
  conceptSummary: string;
  mastery: number;
  transcript: string;
}): Promise<ChatSignals> {
  const result = await groqJson<Partial<ChatSignals>>({
    model: pickModel(input.subject),
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a Performance Analyst reading a live tutoring conversation. You judge how the learner is really doing, not what they claim. Reply with JSON only.",
      },
      {
        role: "user",
        content: `Subject: ${input.subject}
Concept: ${input.conceptTitle} — ${input.conceptSummary}
Current mastery estimate: ${Math.round(input.mastery * 100)}%.

Recent conversation:
${input.transcript}

Judge from the student's own reasoning and answers:
- masteryDelta: how much to move the mastery estimate, between -0.15 and 0.15. Positive for clear correct reasoning in their own words, negative for persistent misconceptions.
- stuck: true if they are circling the same confusion or cannot make progress.
- ahead: true if they clearly already understand this concept (and likely the next ones).
Return JSON: {"masteryDelta":0.0,"stuck":false,"ahead":false,"note":"one sentence describing the evidence"}`,
      },
    ],
  });

  return {
    masteryDelta: Math.min(0.15, Math.max(-0.15, Number(result.masteryDelta) || 0)),
    stuck: Boolean(result.stuck),
    ahead: Boolean(result.ahead),
    note: String(result.note ?? ""),
  };
}

/** Curriculum Designer (re-run): rewrites the live schedule from new evidence. */
export type PathAdaptation = {
  level: string;
  actions: Array<
    | { action: "skip"; conceptTitle: string; reason: string }
    | { action: "remove"; conceptTitle: string; reason: string }
    | {
        action: "insertAfter";
        afterConceptTitle: string;
        concept: { title: string; summary: string; difficulty: string };
        reason: string;
      }
    | {
        action: "retune";
        conceptTitle: string;
        newTitle?: string;
        newSummary?: string;
        newDifficulty?: string;
        reason: string;
      }
  >;
};

export async function adaptLearningPath(input: {
  subject: string;
  goal: string;
  level: string;
  concepts: Array<{
    title: string;
    summary: string;
    difficulty: string;
    status: string;
    mastery: number;
    attempts: number;
  }>;
  currentConceptTitle: string;
  struggleStreak: number;
  teachingStyle: string;
  trigger: "chat" | "check";
  evidence: string;
}): Promise<PathAdaptation> {
  const conceptLines = input.concepts
    .map(
      (c, i) =>
        `${i + 1}. "${c.title}" (${c.difficulty}, ${c.status}, mastery ${Math.round(
          c.mastery * 100,
        )}%, ${c.attempts} attempts) — ${c.summary}`,
    )
    .join("\n");

  const result = await groqJson<Partial<PathAdaptation>>({
    model: pickModel(input.subject),
    temperature: 0.3,
    maxTokens: 2500,
    messages: [
      {
        role: "system",
        content:
          "You are a Curriculum Designer maintaining one student's live learning path. You may only make at most 2 surgical changes per review — never rewrite the whole path. Reply with JSON only.",
      },
      {
        role: "user",
        content: `Subject: ${input.subject}
Goal: ${input.goal}
Current level: ${input.level}
Current concept: "${input.currentConceptTitle}"
Struggle streak: ${input.struggleStreak} · Teaching style: ${input.teachingStyle}
Why this review was triggered: ${input.evidence}

Current schedule:
${conceptLines}

Decide whether the schedule still fits. Allowed actions:
- "skip": the student already knows a concept — mark it mastered and move past it.
- "remove": a concept is redundant for this goal — drop it.
- "insertAfter": a gap appeared — add ONE missing concept (title, one-sentence summary, difficulty) right after a named concept (remediation after a struggle, or a stretch challenge when racing ahead).
- "retune": rename or adjust one concept's difficulty/summary to match the evidence.
Return no actions ("actions":[]) if the schedule is already right.
Return JSON: {"level":"beginner|intermediate|advanced","actions":[{"action":"skip","conceptTitle":"...","reason":"..."}]}`,
      },
    ],
  });

  return {
    level: ["beginner", "intermediate", "advanced"].includes(String(result.level))
      ? String(result.level)
      : input.level,
    actions: (result.actions ?? []).slice(0, 2),
  };
}

export type { ChatMessage };
