# IntelliGuide Tutor

Build a comprehensive AI tutor application powered by multiple specialized AI agents that integrate with the DeepSeek API for core language model capabilities and leverage LangGraph for orchestrating complex, stateful workflows. The system should include the following components and functionalities: **Core Architecture & Agent Design** - Design distinct AI agents with specialized roles: a Curriculum Designer agent (structures learning paths and lesson plans), an Interactive Tutor agent (delivers personalized explanations and Socratic dialogue), a Practice Problem Generator agent (creates adaptive exercises across subjects and difficulty levels), an Assessment Proctor agent (administers timed tests with integrity monitoring), and a Performance Analyst agent (evaluates results and identifies knowledge gaps). **DeepSeek API Integration** - Configure secure API key management for DeepSeek, implementing rate limiting, retry logic with exponential backoff, and fallback handling for API failures. Support model selection between DeepSeek-V3 for general tutoring and DeepSeek-R1 for reasoning-intensive subjects like mathematics and coding. **LangGraph Workflow Orchestration** - Model the complete tutoring lifecycle as a state graph with nodes representing: student onboarding (assessment of prior knowledge), personalized learning path generation, active tutoring sessions (multi-turn dialogue with context retention), practice and reinforcement loops, formal test administration, and performance review with adaptive path adjustment. - Implement conditional edges in the graph for branching logic: if mastery is demonstrated, advance to new material; if struggling, trigger remediation with prerequisite review; if plateau detected, switch pedagogical approach or difficulty calibration. - Maintain persistent thread state across sessions so students can resume exactly where they left off, with full conversation history and performance metrics retained. **Testing & Assessment System** - Generate diverse assessment types: diagnostic entrance exams, formative quizzes during lessons, summative chapter tests, and adaptive standardized-style practice exams. - Implement anti-cheating measures including time limits per question, randomized question pools, shuffled answer choices, and pattern detection for anomalous response behaviors. - Support multiple question formats: multiple choice, free response with rubric-based AI grading, coding challenges with test case validation, and step-by-step mathematical proofs with intermediate reasoning checks. **Performance Review & Analytics** - Build dashboards tracking: concept mastery heatmaps, learning velocity trends, time-on-task analytics, error pattern categorization (careless mistakes vs. conceptual misunderstandings vs. knowledge gaps), and predicted readiness scores for upcoming assessments. - Generate automated review sessions targeting precisely the concepts and question types where the student previously failed, with spaced repetition scheduling based on forgetting curve algorithms. - Produce parent/teacher reports summarizing progress, engagement metrics, and recommended interventions. **Technical Implementation Requirements** - Develop the backend in Python with FastAPI, using LangGraph's checkpointing for state persistence in PostgreSQL or Redis. - Create a responsive frontend (React or Vue) with real-time WebSocket connections for streaming tutor responses. - Implement voice input/output capabilities for accessibility and natural interaction. - Ensure data privacy compliance (FERPA/COPPA) with encrypted storage of student profiles, performance data, and conversation logs. Provide complete, production-ready code for the LangGraph state machine definition, agent node implementations, DeepSeek API client with error handling, assessment generation pipeline, and performance analytics engine. Include deployment configuration with Docker and environment variable templates for API keys and database connections.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://aheadlythetutor.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c0e6536a-0f12-43ed-8dae-36d64ecbebc6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
