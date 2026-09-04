# AI Tutor — Phase 1: Tutor chat + learning path

An AI tutor students sign into, that assesses what they already know, builds a personal learning path, and teaches them through streaming conversation. Powered by DeepSeek using your own API key.

## What changes vs. the original brief

The full system (Python/FastAPI, LangGraph, Redis checkpointing, Docker) can't run on this platform. Everything is built here in React + TypeScript with the built-in database and server-side functions. The tutoring lifecycle is modelled as an explicit state machine in code — same node/edge/branching logic and same persistent per-student state, just not the LangGraph library. Later phases add the assessment engine and analytics.

## Phase 1 scope

**Accounts**
- Email sign-in and sign-up; each student's profile, sessions and progress are private to them.
- Public landing page explaining the tutor, with sign-in call to action.

**Onboarding**
- Pick a subject and goal, then a short diagnostic conversation/quiz that estimates prior knowledge per concept.

**Learning path**
- The Curriculum Designer agent turns the diagnostic result into an ordered path of modules and concepts with prerequisites.
- Path page shows progress: mastered, in progress, locked.

**Tutoring sessions**
- Streaming chat with the Interactive Tutor agent using Socratic questioning, scoped to the current concept.
- One conversation thread per concept, each with its own page address so it can be resumed exactly where it was left; full history saved.
- Short formative check at the end of a concept, which updates mastery.

**Progression logic (the state machine)**
- States: onboarding → path generation → tutoring → practice check → review → next concept.
- Branches: mastery shown → advance; struggling → remediate with prerequisites; no movement across attempts → change explanation style or difficulty.
- Current state and metrics are stored per student so returning resumes the same point.

## Technical notes

- Data: `profiles`, `learning_paths`, `path_concepts`, `sessions`, `messages`, `concept_mastery`, `tutor_state`. Row-level security scopes every row to the signed-in student; grants issued alongside each table.
- Routing: TanStack Start file routes. Public `/`, `/auth`; gated `/onboarding`, `/path`, `/learn/$conceptId`, `/session/$sessionId`.
- DeepSeek client: server-only module with retry + exponential backoff, timeout, rate-limit handling, and clear surfaced errors. Model routing: `deepseek-reasoner` (R1) for math/coding/proof work, `deepseek-chat` (V3) otherwise.
- Streaming: chat runs through a server route so tutor replies stream token by token; the completed reply is saved on finish.
- Agents are prompt+schema modules (curriculum, tutor, checker) called from server functions; structured outputs parsed and validated.
- Your DeepSeek API key is requested through the secure secret form and only ever read server-side.

## Deferred to later phases

Assessment proctoring and anti-cheating, coding challenges with test cases, analytics dashboards and heatmaps, spaced repetition, parent/teacher reports, voice input/output.
