/**
 * Specialised tutor agents. Each agent is a prompt + output contract that runs
 * on top of the Groq client.
 */
import { groqJson, pickModel, type ChatMessage } from "./groq.server";

export type DiagnosticQuestion = { id: string; prompt: string; skill: string };

export type GeneratedConcept = {
  title: string;
  summary: string;
  difficulty: "easy" | "medium" | "hard";
  prerequisites: string[];
  estimatedMastery: number;
};

export type CheckQuestion = { prompt: string; expected: string };

export type CheckGrade = {
  score: number;
  verdict: "mastered" | "progressing" | "struggling";
  feedback: string;
  errorType: "careless" | "conceptual" | "knowledge-gap" | "none";
};

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

Write exactly 4 short open-response diagnostic questions, ordered from easiest to hardest, that probe distinct prerequisite skills.
Return JSON: {"questions":[{"id":"q1","prompt":"...","skill":"..."}]}`,
      },
    ],
  });
  return (result.questions ?? []).slice(0, 4).map((q, i) => ({
    id: q.id || `q${i + 1}`,
    prompt: String(q.prompt ?? ""),
    skill: String(q.skill ?? "general"),
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

Write exactly 3 short free-response questions that test whether the student truly understands this concept (not recall alone).
Return JSON: {"questions":[{"prompt":"...","expected":"the key points a correct answer must contain"}]}`,
      },
    ],
  });
  return (result.questions ?? []).slice(0, 3).map((q) => ({
    prompt: String(q.prompt ?? ""),
    expected: String(q.expected ?? ""),
  }));
}

/** Performance Analyst: rubric grading of the formative check. */
export async function gradeCheck(input: {
  subject: string;
  conceptTitle: string;
  answers: Array<{ prompt: string; expected: string; answer: string }>;
}): Promise<CheckGrade> {
  const transcript = input.answers
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

${transcript}

Grade overall understanding from 0 to 1. Classify the dominant error type.
Return JSON: {"score":0.0,"verdict":"mastered|progressing|struggling","feedback":"2-3 sentences addressed to the student","errorType":"careless|conceptual|knowledge-gap|none"}`,
      },
    ],
  });

  const score = Math.min(1, Math.max(0, Number(result.score) || 0));
  const verdict: CheckGrade["verdict"] =
    result.verdict === "mastered" || result.verdict === "progressing" || result.verdict === "struggling"
      ? result.verdict
      : score >= 0.8
        ? "mastered"
        : score >= 0.5
          ? "progressing"
          : "struggling";

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

export type { ChatMessage };
