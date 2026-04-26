import { type SessionState, type TutorMessage, type Question, type ConceptState, type SelfAssessmentLevel, type MasteryDimension } from '../types';
import { LLMService } from '../llm/LLMService';
import { PromptBuilder, assembleBlocks, type SystemPromptContext } from '../llm/PromptBuilder';
import { type ToolCall, validateToolCalls, getToolDefinitions } from '../llm/tools';
import { generateId } from '../utils/helpers';

const MAX_CONTEXT_MESSAGES = 15;
const SUMMARY_THRESHOLD = 12;
const MAX_RETRIES = 1;

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
  tool: 'ask_question' | 'provide_guidance' | 'assess_mastery' | 'extract_concepts' | 'send_info';
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

type EnginePhase =
  | 'diagnosis'
  | 'extract_concepts'
  | 'ask_question'
  | 'mastery_check'
  | 'practice_task'
  | 'review'
  | 'finalize'
  | null;

type PhaseCallback = (phase: EnginePhase) => void;

export class SocraticEngine {
  private llm: LLMService;
  private promptBuilder: PromptBuilder;
  private language = 'auto';
  private conversationSummaries = new Map<string, string>();
  private phaseCallback: PhaseCallback | null = null;
  constructor(llm: LLMService) {
    this.llm = llm;
    this.promptBuilder = new PromptBuilder();
  }

  setLanguage(lang: string): void {
    this.language = lang;
  }

  setPhaseCallback(callback: PhaseCallback | null): void {
    this.phaseCallback = callback;
  }

  private setPhase(phase: EnginePhase): void {
    this.phaseCallback?.(phase);
  }

  private getPhase(session: SessionState): SystemPromptContext['phase'] {
    if (session.completed) return 'finalize';
    if (session.concepts.length === 0) return 'diagnosis';
    const current = session.currentConceptId
      ? session.concepts.find(c => c.id === session.currentConceptId)
      : null;
    if (current?.status === 'mastered' && this.hasRecentMasteryCheck(session, current.id)) {
      return 'practice';
    }
    if (current && session.messages.filter(m =>
      m.role === 'tutor' && m.question?.conceptId === current.id
    ).length >= 3) {
      return 'mastery-check';
    }
    return 'teaching';
  }

  private hasRecentMasteryCheck(session: SessionState, conceptId: string): boolean {
    const recentMsgs = session.messages.slice(-5);
    return recentMsgs.some(m =>
      m.role === 'tutor'
      && m.type === 'feedback'
      && m.content.includes(conceptId)
    );
  }

  private getConceptProgress(session: SessionState): { mastered: number; total: number } {
    return {
      mastered: session.concepts.filter(c => c.status === 'mastered').length,
      total: session.concepts.length,
    };
  }

  /**
   * Build conversation context with smart truncation and summary injection.
   * When messages exceed SUMMARY_THRESHOLD, early messages are summarized.
   */
  private buildConversationContext(session: SessionState): Array<{ role: 'user' | 'assistant'; content: string }> {
    const slug = session.noteSlug;
    let conversationSummary = this.conversationSummaries.get(slug);

    // Generate summary if message count crosses the threshold
    if (session.messages.length > SUMMARY_THRESHOLD && !conversationSummary) {
      const messagesToSummarize = session.messages.slice(0, SUMMARY_THRESHOLD - 5);
      void this.generateSummary(slug, messagesToSummarize);
    }

    const recentMessages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
    const context = recentMessages.map(m => ({
      role: (m.role === 'tutor' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));

    // Prepend conversation summary at the start if available
    if (conversationSummary) {
      context.unshift({
        role: 'assistant',
        content: `[早期会话摘要]: ${conversationSummary}`,
      });
    }

    return context;
  }

  private async generateSummary(slug: string, messages: TutorMessage[]): Promise<void> {
    try {
      const summaryPrompt = this.promptBuilder.buildConversationSummaryPrompt(
        messages.map(m => ({ role: m.role, content: m.content }))
      );
      const response = await this.llm.chat(
        'You are a conversation summarizer. Summarize the key points concisely.',
        [{ role: 'user', content: summaryPrompt }],
        0.3, 500, undefined
      );
      if (response.content?.trim()) {
        this.conversationSummaries.set(slug, response.content.trim());
      }
    } catch {
      // Silent fail - summary generation is optional
    }
  }

  /**
   * Build system prompt with full context awareness.
   */
  private buildContextAwareSystemPrompt(session: SessionState): string {
    const phase = this.getPhase(session);
    const currentConcept = session.currentConceptId
      ? session.concepts.find(c => c.id === session.currentConceptId)
      : null;
    const progress = this.getConceptProgress(session);
    const slug = session.noteSlug;
    const summary = this.conversationSummaries.get(slug);

    const ctx: SystemPromptContext = {
      noteContent: session.noteContent,
      phase,
      currentConcept,
      conceptProgress: progress,
      language: this.language,
      conversationSummary: summary,
    };

    const blocks = this.promptBuilder.buildSystemPrompt(ctx);
    return assembleBlocks(blocks);
  }

  // --- Step Methods ---

  async stepDiagnosis(session: SessionState, round = 1): Promise<TutorMessage> {
    this.setPhase('diagnosis');
    try {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const diagnosisPrompt = round === 1
        ? this.promptBuilder.buildDiagnosisPrompt()
        : '根据学生上一个回答，追问一个诊断性问题，更好地了解他们的知识水平。关注他们理解不清的地方。';
      const messages = this.buildConversationContext(session);

      const response = await this.withRetry(() => this.llm.chat(systemPrompt, [
        ...messages,
        { role: 'user', content: diagnosisPrompt },
      ], 0.7, 2000, getToolDefinitions()));

      const parsed = this.parseStructuredResponse(response);
      return this.buildTutorMessageFromParsed(parsed);
    } finally {
      this.setPhase(null);
    }
  }

  async stepExtractConcepts(session: SessionState): Promise<{ concepts: ExtractedConcept[] }> {
    this.setPhase('extract_concepts');
    try {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const extractionPrompt = this.promptBuilder.buildConceptExtractionPrompt();

      const response = await this.withRetry(() => this.llm.chat(systemPrompt, [
        { role: 'user', content: extractionPrompt },
      ], 0.3, 2000, getToolDefinitions()));

      const parsed = this.parseStructuredResponse(response);

      if (parsed.concepts && Array.isArray(parsed.concepts) && parsed.concepts.length > 0) {
        return { concepts: parsed.concepts };
      }

      // Lenient fallback: try to parse JSON from content, including markdown code blocks
      const rawContent = response.content || '';
      const extracted = this.tryExtractConceptsFromText(rawContent);
      if (extracted.length > 0) {
        return { concepts: extracted };
      }

      // Second attempt: strict JSON-only prompt without tool calling.
      // Some models ignore tool calling or return preamble text; a stripped-down
      // prompt often forces them into JSON-only mode.
      const retryPrompt = `Analyze the note content and extract 5-15 atomic concepts. Output ONLY a JSON object with this exact structure (no markdown, no explanation, no preamble):

{"concepts":[{"id":"concept-slug","name":"Concept Name","description":"Brief description","dependencies":["other-slug"]}]}

Requirements:
- Each concept has: id (slug format), name, description, dependencies (array of concept ids it depends on)
- Order from basic to advanced
- Use the same language as the note content`;
      const retryResponse = await this.llm.chat(systemPrompt, [
        { role: 'user', content: retryPrompt },
      ], 0.3, 2000);

      const retryParsed = this.parseStructuredResponse(retryResponse);
      if (retryParsed.concepts && Array.isArray(retryParsed.concepts) && retryParsed.concepts.length > 0) {
        return { concepts: retryParsed.concepts };
      }

      const retryExtracted = this.tryExtractConceptsFromText(retryResponse.content || '');
      if (retryExtracted.length > 0) {
        return { concepts: retryExtracted };
      }

      throw new Error(
        `Failed to extract concepts from the note content. ` +
        `Raw response: ${rawContent.slice(0, 500)}`,
      );
    } finally {
      this.setPhase(null);
    }
  }

  private tryExtractConceptsFromText(text: string): ExtractedConcept[] {
    // Try markdown code block first
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const targetText = codeBlockMatch ? codeBlockMatch[1]! : text;

    // Scan for balanced JSON objects using a brace stack.
    // Non-greedy regex fails on nested objects (e.g. {"concepts":[{"id":"a"}]}),
    // so we explicitly track brace depth to find complete top-level objects.
    const candidates = this.extractBalancedJsonObjects(targetText);
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        const concepts = parsed.concepts ?? parsed.data ?? parsed.result;
        if (Array.isArray(concepts) && concepts.length > 0) {
          return concepts.map((c) => ({
            id: String((c as Record<string, unknown>).id ?? ''),
            name: String((c as Record<string, unknown>).name ?? ''),
            description: String((c as Record<string, unknown>).description ?? ''),
            dependencies: Array.isArray((c as Record<string, unknown>).dependencies)
              ? (c as Record<string, unknown>).dependencies as string[]
              : [],
          })).filter((c) => c.id && c.name);
        }
      } catch {
        // Try next candidate
      }
    }
    return [];
  }

  private extractBalancedJsonObjects(text: string): string[] {
    const objects: string[] = [];
    const stack: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        stack.push(i);
      } else if (text[i] === '}' && stack.length > 0) {
        const start = stack.pop()!;
        if (stack.length === 0) {
          objects.push(text.slice(start, i + 1));
        }
      }
    }
    return objects;
  }

  async stepAskQuestion(session: SessionState): Promise<TutorMessage> {
    this.setPhase('ask_question');
    try {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const currentConcept = session.concepts.find(c => c.id === session.currentConceptId);
      const prompt = currentConcept
        ? `你正在教学概念 "${currentConcept.name}"。基于对话历史，提出下一个合适的问题来引导学生学习。记住：永远不要直接给出答案，只能用问题和提示引导。`
        : 'Continue the tutoring session with appropriate Socratic questions based on the conversation so far.';

      const messages = this.buildConversationContext(session);
      const response = await this.withRetry(() => this.llm.chat(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.7, 2000, getToolDefinitions()));

      const parsed = this.parseStructuredResponse(response);
      const tutorMsg = this.buildTutorMessageFromParsed(parsed);

      // Guard: ensure non-empty content with fallback
      if (!tutorMsg.content?.trim() && !tutorMsg.question) {
        tutorMsg.content = '请继续你的思考，告诉我你对这个问题的理解。';
      }

      return tutorMsg;
    } finally {
      this.setPhase(null);
    }
  }

  async stepMasteryCheck(session: SessionState, conceptId: string): Promise<{ message: TutorMessage; dimensions: MasteryDimension }> {
    this.setPhase('mastery_check');
    try {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const concept = session.concepts.find(c => c.id === conceptId);
      if (!concept) throw new Error(`Concept ${conceptId} not found`);

      const prompt = this.promptBuilder.buildMasteryCheckPrompt(concept.name);
      const messages = this.buildConversationContext(session);

      const response = await this.withRetry(() => this.llm.chat(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.5, 1500, getToolDefinitions()));

      const parsed = this.parseStructuredResponse(response);
      const message = this.buildTutorMessageFromParsed(parsed);
      const dimensions: MasteryDimension = parsed.masteryCheck || {
        correctness: false,
        explanationDepth: false,
        novelApplication: false,
        conceptDiscrimination: false,
      };

      return { message, dimensions };
    } finally {
      this.setPhase(null);
    }
  }

  async stepPracticeTask(session: SessionState, conceptId: string): Promise<TutorMessage> {
    this.setPhase('practice_task');
    try {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const concept = session.concepts.find(c => c.id === conceptId);
      if (!concept) throw new Error(`Concept ${conceptId} not found`);

      const prompt = `学生已展示对 "${concept.name}" 的掌握。现在布置一个小练习任务（2-5 分钟）来应用这个概念。选项：
1. 写一个笔记中示例的变体
2. 找出并修复一个关于此概念的声明中的故意错误
3. 用他们自己领域的例子来解释这个概念

要求具体且贴合此概念。`;
      const messages = this.buildConversationContext(session);
      const response = await this.withRetry(() => this.llm.chat(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.7, 2000, getToolDefinitions()));

      const parsed = this.parseStructuredResponse(response);
      return this.buildTutorMessageFromParsed(parsed);
    } finally {
      this.setPhase(null);
    }
  }

  async stepReviewQuestion(session: SessionState, concept: ConceptState): Promise<TutorMessage> {
    this.setPhase('review');
    try {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const prompt = `概念 "${concept.name}" 的快速复习问题（上次复习间隔：${this.formatInterval(concept.reviewInterval)}）。只问一个快速问题。如果回答正确，认可并加倍间隔。如果答错，记录挫折。`;
      const messages = this.buildConversationContext(session);

      const response = await this.withRetry(() => this.llm.chat(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.5, 500, getToolDefinitions()));

      const parsed = this.parseStructuredResponse(response);
      return this.buildTutorMessageFromParsed(parsed);
    } finally {
      this.setPhase(null);
    }
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

  // --- Error Recovery ---

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError || new Error('Operation failed after retries');
  }

  // --- Parsing ---

  private parseStructuredResponse(response: { content: string; toolCalls?: ToolCall[] }): LLMStructuredResponse {
    // Path 1: validated tool calls from the LLM
    if (response.toolCalls && response.toolCalls.length > 0) {
      const validated = validateToolCalls(response.toolCalls);
      if (validated.valid.length > 0) {
        const first = validated.valid[0]!;
        const parsed = this.buildResponseFromValidatedTool(first.name, first.args);
        if (!parsed.content && response.content?.trim()) {
          parsed.content = response.content.trim();
        }
        return parsed;
      }

      // Path 1b: lenient fallback — if validation failed, still try to parse
      // the first tool call directly (matches old behaviour where we JSON.parse
      // without validation). This keeps us resilient to LLMs that return
      // slightly malformed parameters.
      const firstCall = response.toolCalls[0]!;
      try {
        const args = JSON.parse(firstCall.function.arguments) as Record<string, unknown>;
        const parsed = this.buildResponseFromValidatedTool(firstCall.function.name, args);
        if (!parsed.content && response.content?.trim()) {
          parsed.content = response.content.trim();
        }
        return parsed;
      } catch {
        // Fall through to JSON fallback
      }
    }

    // Path 2: JSON fallback in content
    try {
      const raw = response.content || '';
      // Prefer markdown code blocks, then fall back to first JSON object
      const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonText = codeBlock ? codeBlock[1]! : raw;
      const jsonMatch = jsonText.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as LLMStructuredResponse;
        if (parsed.content || parsed.concepts) return parsed;
      }
    } catch {
      // Fall through
    }

    // Path 3: Fallback
    const content = response.content?.trim();
    return {
      tool: 'send_info',
      content: content || '请继续思考并分享你的理解。',
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: null,
      masteryCheck: null,
      misconceptionDetected: null,
    };
  }

  private buildResponseFromValidatedTool(
    toolName: string,
    args: Record<string, unknown>,
  ): LLMStructuredResponse {
    const base: LLMStructuredResponse = {
      tool: toolName as LLMStructuredResponse['tool'],
      content: '',
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: null,
      masteryCheck: null,
      misconceptionDetected: null,
    };

    switch (toolName) {
      case 'ask_question': {
        const a = args as Record<string, unknown>;
        return {
          ...base,
          content: String(a.content ?? ''),
          questionType:
            a.questionType === 'multiple-choice'
              ? ('multiple-choice' as const)
              : a.questionType === 'open-ended'
                ? ('open-ended' as const)
                : null,
          options: Array.isArray(a.options) ? a.options.map(String) : null,
          correctOptionIndex: typeof a.correctOptionIndex === 'number' ? a.correctOptionIndex : null,
          conceptId: typeof a.conceptId === 'string' ? a.conceptId : null,
        };
      }
      case 'provide_guidance': {
        const a = args as Record<string, unknown>;
        return {
          ...base,
          content: String(a.content ?? ''),
          conceptId: typeof a.conceptId === 'string' ? a.conceptId : null,
          misconceptionDetected: typeof a.misconception === 'string'
            ? { misconception: a.misconception, rootCause: typeof a.rootCause === 'string' ? a.rootCause : '' }
            : null,
        };
      }
      case 'assess_mastery': {
        const a = args as Record<string, unknown>;
        return {
          ...base,
          content: String(a.content ?? ''),
          conceptId: typeof a.conceptId === 'string' ? a.conceptId : null,
          masteryCheck: {
            correctness: a.correctness === true,
            explanationDepth: a.explanationDepth === true,
            novelApplication: a.novelApplication === true,
            conceptDiscrimination: a.conceptDiscrimination === true,
          },
        };
      }
      case 'extract_concepts': {
        const a = args as Record<string, unknown>;
        return {
          ...base,
          content: '',
          concepts: Array.isArray(a.concepts) ? a.concepts : undefined,
        };
      }
      case 'send_info':
      default: {
        const a = args as Record<string, unknown>;
        return {
          ...base,
          content: String(a.content ?? ''),
          conceptId: typeof a.conceptId === 'string' ? a.conceptId : null,
        };
      }
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
