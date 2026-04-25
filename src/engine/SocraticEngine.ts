import { type SessionState, type TutorMessage, type Question, type ConceptState, type MisconceptionRecord, type SelfAssessmentLevel, type MasteryDimension } from '../types';
import { LLMService } from '../llm/LLMService';
import { PromptBuilder } from '../llm/PromptBuilder';
import { TOOLS, type ToolCall, type ToolName, type MultipleChoiceArgs, type GuidanceArgs, type MasteryCheckArgs, type ConceptExtractionArgs, type InfoArgs } from '../llm/tools';
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
  tool: ToolName;
  type?: 'question' | 'feedback' | 'info' | 'check-complete' | 'concept-extraction';
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
  concepts?: ExtractedConcept[];
}

export class SocraticEngine {
  private llm: LLMService;
  private promptBuilder: PromptBuilder;
  private language = 'auto';

  constructor(llm: LLMService) {
    this.llm = llm;
    this.promptBuilder = new PromptBuilder();
  }

  setLanguage(lang: string): void {
    this.language = lang;
  }

  async stepDiagnosis(session: SessionState, round = 1): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent, undefined, this.language);
    const diagnosisPrompt = round === 1
      ? this.promptBuilder.buildDiagnosisPrompt()
      : 'Based on the student\'s previous answer, ask a follow-up diagnostic question to better understand their knowledge level. Focus on areas where their understanding seems unclear.';
    const messages = this.buildConversationContext(session);

    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: diagnosisPrompt },
    ], 0.7, 2000, TOOLS);

    const parsed = this.parseStructuredResponse(response);
    return this.buildTutorMessage(parsed, 'question');
  }

  async stepExtractConcepts(session: SessionState): Promise<{ concepts: { id: string; name: string; description: string; dependencies: string[] }[] }> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent, undefined, this.language);
    const extractionPrompt = this.promptBuilder.buildConceptExtractionPrompt();

    const response = await this.llm.chat(systemPrompt, [
      { role: 'user', content: extractionPrompt },
    ], 0.3, 2000, TOOLS);

    const parsed = this.parseStructuredResponse(response);

    // Check for tool-call-based concept extraction
    if (parsed.concepts && Array.isArray(parsed.concepts)) {
      return { concepts: parsed.concepts };
    }

    // Fallback: try direct JSON parsing
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const directParsed = JSON.parse(jsonMatch[0]) as ConceptExtractionResponse;
        if (directParsed.concepts && Array.isArray(directParsed.concepts)) {
          return { concepts: directParsed.concepts };
        }
      }
    } catch {
      // Fall through
    }
    throw new Error('Failed to extract concepts from the note content.');
  }

  async stepAskQuestion(session: SessionState): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent, undefined, this.language);
    const currentConcept = session.concepts.find(c => c.id === session.currentConceptId);
    const prompt = currentConcept
      ? `Continue tutoring the concept "${currentConcept.name}". Based on the conversation so far, ask the next appropriate question. Remember: never give answers, only guide.`
      : 'Continue the tutoring session with appropriate Socratic questions based on the conversation so far.';

    const messages = this.buildConversationContext(session);
    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ], 0.7, 2000, TOOLS);

    const parsed = this.parseStructuredResponse(response);
    return this.buildTutorMessageFromParsed(parsed);
  }

  async stepProcessAnswer(session: SessionState, userAnswer: string): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent, undefined, this.language);
    const currentConcept = session.concepts.find(c => c.id === session.currentConceptId);
    const prompt = currentConcept
      ? `The student answered: "${userAnswer}"\n\nAnalyze their answer for concept "${currentConcept.name}". Provide appropriate Socratic response based on answer quality. If they're correct, ask a harder follow-up. If partially correct, give a small hint. If wrong, present a counterexample. If they say "I don't know", break it down into smaller sub-questions.`
      : `The student answered: "${userAnswer}"\n\nRespond appropriately with a Socratic follow-up.`;

    const messages = this.buildConversationContext(session);
    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ], 0.7, 2000, TOOLS);

    const parsed = this.parseStructuredResponse(response);
    return this.buildTutorMessageFromParsed(parsed);
  }

  async stepMasteryCheck(session: SessionState, conceptId: string): Promise<{ message: TutorMessage; dimensions: MasteryDimension }> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent, undefined, this.language);
    const concept = session.concepts.find(c => c.id === conceptId);
    if (!concept) throw new Error(`Concept ${conceptId} not found`);

    const prompt = this.promptBuilder.buildMasteryCheckPrompt(concept.name);
    const messages = this.buildConversationContext(session);

    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ], 0.5, 1500, TOOLS);

    const parsed = this.parseStructuredResponse(response);
    const message = this.buildTutorMessageFromParsed(parsed);
    const dimensions: MasteryDimension = parsed.masteryCheck || {
      correctness: false,
      explanationDepth: false,
      novelApplication: false,
      conceptDiscrimination: false,
    };

    return { message, dimensions };
  }

  async stepPracticeTask(session: SessionState, conceptId: string): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent, undefined, this.language);
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
    ], 0.7, 2000, TOOLS);

    const parsed = this.parseStructuredResponse(response);
    return this.buildTutorMessageFromParsed(parsed);
  }

  async stepReviewQuestion(session: SessionState, concept: ConceptState): Promise<TutorMessage> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt(session.noteContent, undefined, this.language);
    const prompt = `Quick review question for "${concept.name}" (past review interval: ${this.formatInterval(concept.reviewInterval)}). Ask just one quick question. If answered correctly, acknowledge and double the interval. If wrong, note the setback.`;
    const messages = this.buildConversationContext(session);

    const response = await this.llm.chat(systemPrompt, [
      ...messages,
      { role: 'user', content: prompt },
    ], 0.5, 500, TOOLS);

    const parsed = this.parseStructuredResponse(response);
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
      role: (m.role === 'tutor' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));
  }

  private parseStructuredResponse(response: { content: string; toolCalls?: ToolCall[] }): LLMStructuredResponse {
    // Priority 1: Handle tool_calls from the API
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0]!;
      const parsed = this.parseToolCall(toolCall);
      // If tool call args had empty content but raw response has text, use raw text as fallback
      if (!parsed.content && response.content?.trim()) {
        parsed.content = response.content.trim();
      }
      return parsed;
    }

    // Priority 2: Try JSON parsing from content
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as LLMStructuredResponse;
        if (parsed.content) return parsed;
      }
    } catch {
      // Fall through
    }

    // Fallback: return content as plain info
    return {
      tool: 'send_info',
      content: response.content || '',
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: null,
      masteryCheck: null,
      misconceptionDetected: null,
    };
  }

  private parseToolCall(toolCall: ToolCall): LLMStructuredResponse {
    const base: LLMStructuredResponse = {
      tool: toolCall.function.name,
      content: '',
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: null,
      masteryCheck: null,
      misconceptionDetected: null,
    };

    try {
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

      switch (toolCall.function.name) {
        case 'ask_question': {
          const qArgs = args as unknown as MultipleChoiceArgs & { questionType?: string };
          return {
            ...base,
            content: qArgs.content,
            questionType: qArgs.questionType === 'multiple-choice' ? 'multiple-choice' as const : 'open-ended' as const,
            options: qArgs.options || null,
            correctOptionIndex: qArgs.correctOptionIndex ?? null,
            conceptId: qArgs.conceptId || null,
          };
        }

        case 'provide_guidance': {
          const gArgs = args as unknown as GuidanceArgs;
          return {
            ...base,
            content: gArgs.content,
            conceptId: gArgs.conceptId || null,
            misconceptionDetected: gArgs.misconception
              ? { misconception: gArgs.misconception, rootCause: gArgs.rootCause || '' }
              : null,
          };
        }

        case 'assess_mastery': {
          const mArgs = args as unknown as MasteryCheckArgs;
          return {
            ...base,
            content: mArgs.content,
            conceptId: mArgs.conceptId || null,
            masteryCheck: {
              correctness: mArgs.correctness,
              explanationDepth: mArgs.explanationDepth,
              novelApplication: mArgs.novelApplication,
              conceptDiscrimination: mArgs.conceptDiscrimination,
            },
          };
        }

        case 'extract_concepts': {
          const eArgs = args as unknown as ConceptExtractionArgs;
          return {
            ...base,
            content: '',
            concepts: eArgs.concepts,
          };
        }

        case 'send_info':
        default: {
          const iArgs = args as unknown as InfoArgs;
          return {
            ...base,
            content: iArgs.content,
            conceptId: iArgs.conceptId || null,
          };
        }
      }
    } catch {
      // Return base with empty content — caller should fall back to raw response text
      return base;
    }
  }

  private buildTutorMessageFromParsed(parsed: LLMStructuredResponse): TutorMessage {
    const questionType = parsed.questionType || null;
    const content = parsed.content || '';
    const question: Question | undefined = questionType && parsed.options
      ? {
          id: generateId(),
          conceptId: parsed.conceptId || '',
          type: questionType,
          prompt: content,
          options: parsed.options || undefined,
          correctOptionIndex: parsed.correctOptionIndex ?? undefined,
        }
      : undefined;

    const type = this.inferMessageType(parsed);

    return {
      id: generateId(),
      role: 'tutor',
      type,
      content,
      question,
      timestamp: Date.now(),
    };
  }

  private buildTutorMessage(parsed: LLMStructuredResponse, fallbackType: TutorMessage['type']): TutorMessage {
    if (parsed.tool) {
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

  private inferMessageType(parsed: LLMStructuredResponse): TutorMessage['type'] {
    if (parsed.tool === 'ask_question') return 'question';
    if (parsed.tool === 'provide_guidance') return 'feedback';
    if (parsed.tool === 'assess_mastery') return 'feedback';
    if (parsed.tool === 'extract_concepts') return 'info';
    if (parsed.tool === 'send_info') return 'info';
    if (parsed.type) {
      if (parsed.type === 'check-complete') return 'info';
      return parsed.type as TutorMessage['type'];
    }
    return 'info';
  }

  private formatInterval(seconds: number): string {
    if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }
}
