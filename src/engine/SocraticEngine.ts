import { type SessionState, type TutorMessage, type Question, type ConceptState, type MisconceptionRecord, type SelfAssessmentLevel, type MasteryDimension } from '../types';
import { LLMService } from '../llm/LLMService';
import { PromptBuilder } from '../llm/PromptBuilder';
import { generateId } from '../utils/helpers';

interface ExtractedConcept {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
}

interface ConceptExtractionResponse {
  concepts: ExtractedConcept[];
}

interface LLMStructuredResponse {
  type: 'question' | 'feedback' | 'info' | 'check-complete' | 'concept-extraction';
  questionType: 'multiple-choice' | 'open-ended' | null;
  content: string;
  options: string[] | null;
  correctOptionIndex: number | null;
  conceptId: string | null;
  masteryCheck: {
    correctness: boolean;
    explanationDepth: boolean;
    novelApplication: boolean;
    conceptDiscrimination: boolean;
  } | null;
  misconceptionDetected: {
    misconception: string;
    rootCause: string;
  } | null;
}

export class SocraticEngine {
  private llm: LLMService;
  private promptBuilder: PromptBuilder;

  constructor(llm: LLMService) {
    this.llm = llm;
    this.promptBuilder = new PromptBuilder();
  }

  async stepDiagnosis(session: SessionState): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent);
    const diagnosisPrompt = this.promptBuilder.buildDiagnosisPrompt();
    const messages = this.buildConversationContext(session);

    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: diagnosisPrompt },
    ]);

    const parsed = this.parseResponse(response.content);
    return this.buildTutorMessage(parsed, 'question');
  }

  async stepExtractConcepts(session: SessionState): Promise<{ concepts: { id: string; name: string; description: string; dependencies: string[] }[] }> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent);
    const extractionPrompt = this.promptBuilder.buildConceptExtractionPrompt();

    const response = await this.llm.chat(systemPrompt, [
      { role: 'user', content: extractionPrompt },
    ]);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ConceptExtractionResponse;
        if (parsed.concepts && Array.isArray(parsed.concepts)) {
          return { concepts: parsed.concepts };
        }
      }
    } catch {
      // Fall through
    }
    throw new Error('Failed to extract concepts from the note content.');
  }

  async stepAskQuestion(session: SessionState): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent);
    const currentConcept = session.concepts.find(c => c.id === session.currentConceptId);
    const prompt = currentConcept
      ? `Continue tutoring the concept "${currentConcept.name}". Based on the conversation so far, ask the next appropriate question. Remember: never give answers, only guide.`
      : 'Continue the tutoring session with appropriate Socratic questions based on the conversation so far.';

    const messages = this.buildConversationContext(session);
    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ]);

    const parsed = this.parseResponse(response.content);
    return this.buildTutorMessageFromParsed(parsed);
  }

  async stepProcessAnswer(session: SessionState, userAnswer: string): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent);
    const currentConcept = session.concepts.find(c => c.id === session.currentConceptId);
    const prompt = currentConcept
      ? `The student answered: "${userAnswer}"\n\nAnalyze their answer for concept "${currentConcept.name}". Provide appropriate Socratic response based on answer quality. If they're correct, ask a harder follow-up. If partially correct, give a small hint. If wrong, present a counterexample. If they say "I don't know", break it down into smaller sub-questions.`
      : `The student answered: "${userAnswer}"\n\nRespond appropriately with a Socratic follow-up.`;

    const messages = this.buildConversationContext(session);
    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ]);

    const parsed = this.parseResponse(response.content);
    return this.buildTutorMessageFromParsed(parsed);
  }

  async stepMasteryCheck(session: SessionState, conceptId: string): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent);
    const concept = session.concepts.find(c => c.id === conceptId);
    if (!concept) throw new Error(`Concept ${conceptId} not found`);

    const prompt = this.promptBuilder.buildMasteryCheckPrompt(concept.name);
    const messages = this.buildConversationContext(session);

    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ]);

    const parsed = this.parseResponse(response.content);
    return this.buildTutorMessageFromParsed(parsed);
  }

  async stepPracticeTask(session: SessionState, conceptId: string): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent);
    const concept = session.concepts.find(c => c.id === conceptId);
    if (!concept) throw new Error(`Concept ${conceptId} not found`);

    const prompt = `The student has shown mastery of "${concept.name}". Now assign a small practice task (2-5 minutes) that applies this concept. Options:
1. Write a variation of an example from the note
2. Find and fix an intentional error in a statement about this concept
3. Explain this concept using an example from their own field

Make it concrete and specific to this concept.`;
    const messages = this.buildConversationContext(session);
    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ]);

    const parsed = this.parseResponse(response.content);
    return this.buildTutorMessageFromParsed(parsed);
  }

  async stepReviewQuestion(session: SessionState, concept: ConceptState): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent);
    const prompt = `Quick review question for "${concept.name}" (past review interval: ${this.formatInterval(concept.reviewInterval)}). Ask just one quick question. If answered correctly, acknowledge and double the interval. If wrong, note the setback.`;
    const messages = this.buildConversationContext(session);

    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ], 0.5, 500);

    const parsed = this.parseResponse(response.content);
    return this.buildTutorMessageFromParsed(parsed);
  }

  updateMasteryFromCheck(session: SessionState, conceptId: string, dimensions: MasteryDimension, selfAssessment: SelfAssessmentLevel): { passed: boolean; newScore: number } {
    const concept = session.concepts.find(c => c.id === conceptId);
    if (!concept) return { passed: false, newScore: 0 };

    const dimensionScore = [
      dimensions.correctness,
      dimensions.explanationDepth,
      dimensions.novelApplication,
      dimensions.conceptDiscrimination,
    ].filter(Boolean).length / 4 * 100;

    concept.masteryScore = Math.round((concept.masteryScore + dimensionScore) / 2);
    concept.lastReviewTime = Date.now();
    concept.selfAssessment = selfAssessment;

    const passed = concept.masteryScore >= 80;
    return { passed, newScore: concept.masteryScore };
  }

  addMisconception(session: SessionState, conceptId: string, misconception: string, rootCause: string): MisconceptionRecord {
    const record: MisconceptionRecord = {
      id: generateId(),
      conceptId,
      misconception,
      inferredRootCause: rootCause,
      resolved: false,
      resolvedDate: null,
      userExplanation: null,
    };
    session.misconceptions.push(record);
    return record;
  }

  resolveMisconception(session: SessionState, misconceptionId: string): boolean {
    const record = session.misconceptions.find(m => m.id === misconceptionId);
    if (!record || record.resolved) return false;
    record.resolved = true;
    record.resolvedDate = Date.now();
    return true;
  }

  updateReviewInterval(concept: ConceptState, correct: boolean): number {
    if (correct) {
      concept.reviewInterval = Math.min(
        concept.reviewInterval * 2,
        2764800
      );
    } else {
      concept.reviewInterval = 86400;
    }
    return concept.reviewInterval;
  }

  calculateNextReviewInterval(concept: ConceptState): number {
    if (concept.reviewInterval === 0) return 86400;
    return Math.min(concept.reviewInterval * 2, 2764800);
  }

  private buildConversationContext(session: SessionState): { role: 'user' | 'assistant'; content: string }[] {
    const recentMessages = session.messages.slice(-10);
    return recentMessages.map(m => ({
      role: m.role === 'tutor' ? 'assistant' : 'user' as 'user' | 'assistant',
      content: m.content,
    }));
  }

  private parseResponse(raw: string): Partial<LLMStructuredResponse> {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as LLMStructuredResponse;
      }
    } catch {
      // Fall through to default
    }
    return {
      type: 'info',
      content: raw,
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: null,
      masteryCheck: null,
      misconceptionDetected: null,
    };
  }

  private buildTutorMessageFromParsed(parsed: Partial<LLMStructuredResponse>): TutorMessage {
    const questionType = parsed.questionType || null;
    const question: Question | undefined = questionType && parsed.options
      ? {
          id: generateId(),
          conceptId: parsed.conceptId || '',
          type: questionType,
          prompt: parsed.content || '',
          options: parsed.options || undefined,
          correctOptionIndex: parsed.correctOptionIndex ?? undefined,
        }
      : undefined;

    return {
      id: generateId(),
      role: 'tutor',
      type: (parsed.type === 'check-complete' ? 'info' : parsed.type || 'info') as TutorMessage['type'],
      content: parsed.content || '',
      question,
      timestamp: Date.now(),
    };
  }

  private buildTutorMessage(parsed: Partial<LLMStructuredResponse>, fallbackType: TutorMessage['type']): TutorMessage {
    if (parsed.type) {
      return this.buildTutorMessageFromParsed(parsed);
    }
    return {
      id: generateId(),
      role: 'tutor',
      type: fallbackType,
      content: parsed.content || '',
      timestamp: Date.now(),
    };
  }

  private formatInterval(seconds: number): string {
    if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }
}
