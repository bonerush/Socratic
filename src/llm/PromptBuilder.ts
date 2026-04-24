import type { SessionState, LearnerProfile } from '../types';

export class PromptBuilder {
  buildSystemPrompt(noteContent: string, learnerProfile?: LearnerProfile | null): string {
    const profileSection = learnerProfile
      ? `\n## Learner Profile\nThis learner has the following traits from previous sessions:\n- Learning style: ${learnerProfile.learningStyle}\n- Common misconception patterns: ${learnerProfile.commonMisconceptionPatterns.join(', ')}\n- Previous sessions completed: ${learnerProfile.sessionCount}\n`
      : '';

    return `You are a Socratic tutor implementing Bloom's 2-Sigma mastery learning method. Your ONLY role is to ask questions that guide the student to discover answers themselves — you NEVER give direct answers.

## Core Rules (NEVER Violate)
1. NEVER give direct answers — only ask guiding questions, request explanations, give minimal hints, or present counterexamples.
2. Diagnose first — assess the student's existing knowledge before diving into content.
3. Mastery gate — each concept requires ≥80% score across correctness, explanation depth, novel application, and concept discrimination before advancing.
4. Ask 1-2 questions per turn — keep focus, don't pile on.
5. Be patient but rigorous — encourage, but never let misunderstandings slide. Use counterexamples to let the student discover contradictions.
6. Match the user's language — keep technical terms in original with brief explanations.
7. ALL teaching must be based SOLELY on the provided note content — do not introduce external information.

## Note Content to Teach
\`\`\`
${noteContent}
\`\`\`
${profileSection}
## Response Format
Respond in JSON format:
{
  "type": "question" | "feedback" | "info" | "check-complete",
  "questionType": "multiple-choice" | "open-ended" | null,
  "content": "Your message to the student",
  "options": ["Option A", "Option B", "Option C", "Option D"] | null,
  "correctOptionIndex": 0 | null,
  "conceptId": "current-concept-id",
  "masteryCheck": { "correctness": bool, "explanationDepth": bool, "novelApplication": bool, "conceptDiscrimination": bool } | null,
  "misconceptionDetected": { "misconception": "description", "rootCause": "inferred cause" } | null
}`;
  }

  buildDiagnosisPrompt(): string {
    return 'Please start by diagnosing the student\'s current understanding. Ask 1-2 questions (mix of multiple-choice and open-ended) to assess their existing knowledge about this topic. Do not teach yet — just diagnose.';
  }

  buildConceptExtractionPrompt(): string {
    return `Analyze the note content and extract 5-15 atomic concepts/key知识点 that the student needs to master. For each concept, provide:
1. A unique ID (slug format, e.g., "python-decorators")
2. A clear name
3. A brief description
4. Dependencies (which concepts should be learned before this one)

Respond in JSON format:
{
  "concepts": [
    {
      "id": "concept-slug",
      "name": "Concept Name",
      "description": "Brief description",
      "dependencies": ["dependency-id-1"]
    }
  ]
}

Order concepts from foundational to advanced based on their dependency relationships.`;
  }

  buildMasteryCheckPrompt(conceptName: string): string {
    return `Conduct a mastery check for the concept "${conceptName}". Ask questions covering all 4 dimensions:
1. Correctness (factual accuracy)
2. Explanation depth (can explain "why")
3. Novel application (can handle unseen scenarios)
4. Concept discrimination (can distinguish from similar concepts)

Score each dimension in your response's masteryCheck field.`;
  }
}
