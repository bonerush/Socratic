import { type SessionState, type TutorMessage, type ConceptState, type MasteryDimension } from '../types';
import { LLMService } from '../llm/LLMService';
import { PromptBuilder, assembleBlocks, type SystemPromptContext } from '../llm/PromptBuilder';
import { getToolDefinitionsForPhase } from '../llm/tools';
import { generateId, formatInterval } from '../utils/common';
import { countRoundsForConcept } from '../utils/session';
import type { Tracer } from '../debug/Tracer';
import { ResponseParser, type ExtractedConcept } from './ResponseParser';
import { ResponseHealer } from './ResponseHealer';

const MAX_CONTEXT_MESSAGES = 15;
const SUMMARY_THRESHOLD = 12;

type EnginePhase =
  | 'diagnosis'
  | 'extract_concepts'
  | 'teaching'
  | 'mastery_check'
  | 'practice_task'
  | 'review'
  | 'finalize'
  | 'explain_selection'
  | null;

type PhaseCallback = (phase: EnginePhase) => void;

export class SocraticEngine {
  private llm: LLMService;
  private promptBuilder: PromptBuilder;
  private language = 'auto';
  private conversationSummaries = new Map<string, string>();
  private phaseCallback: PhaseCallback | null = null;
  private tracer: Tracer | null = null;
  private sessionSlug = 'unknown';
  private parser: ResponseParser;
  private healer: ResponseHealer;

  constructor(llm: LLMService) {
    this.llm = llm;
    this.promptBuilder = new PromptBuilder();
    this.parser = new ResponseParser();
    this.healer = new ResponseHealer(this.llm);
  }

  setLanguage(lang: string): void {
    this.language = lang;
  }

  setPhaseCallback(callback: PhaseCallback | null): void {
    this.phaseCallback = callback;
  }

  setTracer(tracer: Tracer | null): void {
    this.tracer = tracer;
    this.parser = new ResponseParser(tracer);
    this.healer = new ResponseHealer(this.llm, tracer);
  }

  setSessionSlug(slug: string): void {
    this.sessionSlug = slug;
  }

  private setPhase(phase: EnginePhase): void {
    this.phaseCallback?.(phase);
  }

  private async withPhase<T>(phase: EnginePhase, fn: () => Promise<T>): Promise<T> {
    this.setPhase(phase);
    this.tracer?.phaseStart(this.sessionSlug, phase ?? 'unknown');
    try {
      return await fn();
    } finally {
      this.setPhase(null);
      this.tracer?.phaseEnd(this.sessionSlug, phase ?? 'unknown');
    }
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
    if (current) {
      const rounds = countRoundsForConcept(session.messages, current.id);
      if (rounds >= 3 && !this.hasRecentMasteryCheck(session, current.id)) {
        return 'mastery-check';
      }
    }
    return 'teaching';
  }

  private hasRecentMasteryCheck(session: SessionState, _conceptId: string): boolean {
    const recentMsgs = session.messages.slice(-5);
    return recentMsgs.some(m =>
      m.role === 'tutor'
      && m.type === 'feedback'
      && (m.content.startsWith('Mastery:') || m.content.startsWith('掌握度：'))
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
    const context = recentMessages
      // Exclude revoked messages so cancelled user inputs don't leak into LLM context.
      .filter(m => !m.revoked)
      // Exclude system-generated mastery feedback from the conversation context
      // to prevent the LLM from mistaking it as prompt injection.
      .filter(m => !(m.role === 'tutor' && m.type === 'feedback' &&
        (m.content.startsWith('Mastery:') || m.content.startsWith('掌握度：'))))
      .map((m): { role: 'user' | 'assistant'; content: string } => ({
        role: m.role === 'tutor' ? 'assistant' : 'user',
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

  async stepExplainSelection(session: SessionState, selection: string): Promise<TutorMessage> {
    this.tracer?.engineStep(this.sessionSlug, 'stepExplainSelection', { selectionLength: selection.length });
    return this.withPhase('explain_selection', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const prompt = this.promptBuilder.buildExplainSelectionPrompt(selection);
      const messages = this.buildConversationContext(session);

      const parsed = await this.healer.chatWithEmptyContentHealing(
        this.sessionSlug,
        systemPrompt,
        [
          ...messages,
          { role: 'user', content: prompt },
        ],
        0.7,
        2000,
        getToolDefinitionsForPhase('teaching'),
        true,
        (response) => this.parser.parseStructuredResponse(response),
      );

      let tutorMsg = this.parser.buildTutorMessageFromParsed(this.sessionSlug, parsed);

      return this.withContentFallback(tutorMsg);
    });
  }

  async stepDiagnosis(session: SessionState, round = 1): Promise<TutorMessage> {
    this.tracer?.engineStep(this.sessionSlug, 'stepDiagnosis', { round });
    return this.withPhase('diagnosis', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const basePrompt = round === 1
        ? this.promptBuilder.buildDiagnosisPrompt()
        : '根据学生上一个回答，追问一个诊断性问题，更好地了解他们的知识水平。关注他们理解不清的地方。';
      const diagnosisPrompt = `${basePrompt}\n\nCRITICAL: 你必须调用 provide_guidance 工具返回你的回应。不要输出纯文本——纯文本会被系统忽略。`;
      const messages = this.buildConversationContext(session);

      const parsed = await this.healer.chatWithEmptyContentHealing(
        this.sessionSlug,
        systemPrompt,
        [
          ...messages,
          { role: 'user', content: diagnosisPrompt },
        ],
        0.7,
        2000,
        getToolDefinitionsForPhase('diagnosis'),
        true,
        (response) => this.parser.parseStructuredResponse(response),
      );

      let tutorMsg = this.parser.buildTutorMessageFromParsed(this.sessionSlug, parsed);

      // Guard: in diagnosis phase the model MUST use provide_guidance.
      // If it returns extract_concepts or another wrong tool, treat it as
      // malformed and inject a safe default so the user sees a real question.
      if (parsed.tool !== 'provide_guidance') {
        const fallbackContent = '你对这个主题已经有哪些了解？请简单描述一下，我会根据你的回答提出下一个问题。';
        tutorMsg = {
          ...tutorMsg,
          content: fallbackContent,
          type: 'question',
          question: {
            id: generateId(),
            conceptId: '',
            type: 'open-ended',
            prompt: fallbackContent,
          },
        };
      }

      // Guard: if the LLM described a scenario but didn't actually ask a question
      // (no question mark in content), append a direct question so the user knows
      // what to answer.
      const hasQuestionMark = /[?？]/.test(tutorMsg.content);
      if (!hasQuestionMark && tutorMsg.type !== 'info') {
        const appendedContent = tutorMsg.content + '\n\n你对这个主题已经有哪些了解？请简单描述一下。';
        if (!tutorMsg.question) {
          tutorMsg = {
            ...tutorMsg,
            content: appendedContent,
            type: 'question',
            question: {
              id: generateId(),
              conceptId: '',
              type: 'open-ended',
              prompt: appendedContent,
            },
          };
        } else {
          tutorMsg = { ...tutorMsg, content: appendedContent };
        }
      }

      return this.withContentFallback(tutorMsg);
    });
  }

  async stepExtractConcepts(session: SessionState): Promise<{ concepts: ExtractedConcept[] }> {
    this.tracer?.engineStep(this.sessionSlug, 'stepExtractConcepts');
    return this.withPhase('extract_concepts', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const extractionPrompt = this.promptBuilder.buildConceptExtractionPrompt();

      const response = await this.healer.chatWithSelfCorrection(
        this.sessionSlug,
        systemPrompt,
        [
          { role: 'user', content: extractionPrompt },
        ],
        0.3,
        2000,
        getToolDefinitionsForPhase('extract_concepts'),
      );

      const parsed = this.parser.parseStructuredResponse(response);

      if (parsed.concepts && Array.isArray(parsed.concepts) && parsed.concepts.length > 0) {
        return { concepts: parsed.concepts };
      }

      // Lenient fallback: try to parse JSON from content, including markdown code blocks
      const rawContent = response.content || '';
      const extracted = this.parser.tryExtractConceptsFromText(rawContent);
      if (extracted.length > 0) {
        return { concepts: extracted };
      }

      // Second attempt: strict JSON-only prompt without tool calling.
      // Some models ignore tool calling or return preamble text; a stripped-down
      // prompt often forces them into JSON-only mode.
      const retryPrompt = `从笔记内容中提取 5-15 个原子概念。只输出一个 JSON 对象，不要任何解释、前言或 Markdown 代码块。严格使用以下格式：

{"concepts":[{"id":"concept-slug","name":"概念名称","description":"简要描述","dependencies":["other-slug"]}]}

要求：
- 每个概念包含：id（短横线格式）、name（名称）、description（描述）、dependencies（依赖的其他概念 id 数组）
- 按从基础到高级排序
- 使用与笔记内容相同的语言`;
      const retryResponse = await this.llm.chat(systemPrompt, [
        { role: 'user', content: retryPrompt },
      ], 0.3, 2000, undefined, true);

      const retryParsed = this.parser.parseStructuredResponse(retryResponse);
      if (retryParsed.concepts && Array.isArray(retryParsed.concepts) && retryParsed.concepts.length > 0) {
        return { concepts: retryParsed.concepts };
      }

      const retryExtracted = this.parser.tryExtractConceptsFromText(retryResponse.content || '');
      if (retryExtracted.length > 0) {
        return { concepts: retryExtracted };
      }

      throw new Error(
        `Failed to extract concepts from the note content. ` +
        `Raw response: ${rawContent.slice(0, 500)}`,
      );
    });
  }

  async stepAskQuestion(session: SessionState): Promise<TutorMessage> {
    this.tracer?.engineStep(this.sessionSlug, 'stepAskQuestion', { currentConceptId: session.currentConceptId });
    return this.withPhase('teaching', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const currentConcept = session.concepts.find(c => c.id === session.currentConceptId);
      const prompt = currentConcept
        ? `你正在教学概念 "${currentConcept.name}"（概念ID: ${currentConcept.id}）。基于对话历史，提出下一个合适的教学消息来引导学生学习。记住：永远不要直接给出答案，只能用问题和提示引导。\n\nCRITICAL: 你必须调用 provide_guidance 工具。不要输出纯文本——纯文本会被系统忽略。\n\n重要：请在 conceptId 字段中填写当前概念ID "${currentConcept.id}"，以便系统正确追踪学习进度。如果是选择题，必须同时提供 options 数组和 correctOptionIndex。`
        : 'Continue the tutoring session with appropriate Socratic guidance based on the conversation so far.\n\nCRITICAL: You MUST call the provide_guidance tool. Do NOT output plain text — plain text will be ignored by the system.';

      const messages = this.buildConversationContext(session);
      const parsed = await this.healer.chatWithEmptyContentHealing(
        this.sessionSlug,
        systemPrompt,
        [
          ...messages,
          { role: 'user', content: prompt },
        ],
        0.7,
        2000,
        getToolDefinitionsForPhase('teaching'),
        true,
        (response) => this.parser.parseStructuredResponse(response),
      );

      let tutorMsg = this.parser.buildTutorMessageFromParsed(this.sessionSlug, parsed);

      // Inject current conceptId if LLM omitted it, so round-counting works reliably.
      if (tutorMsg.question && !tutorMsg.question.conceptId && session.currentConceptId) {
        tutorMsg = {
          ...tutorMsg,
          question: { ...tutorMsg.question, conceptId: session.currentConceptId },
        };
      }

      if (!tutorMsg.content?.trim() && !tutorMsg.question) {
        tutorMsg = { ...tutorMsg, content: '...' };
      }

      return tutorMsg;
    });
  }

  async stepMasteryCheck(session: SessionState, conceptId: string): Promise<TutorMessage> {
    this.tracer?.engineStep(this.sessionSlug, 'stepMasteryCheck', { conceptId });
    return this.withPhase('mastery_check', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const concept = session.concepts.find(c => c.id === conceptId);
      if (!concept) throw new Error(`Concept ${conceptId} not found`);

      const prompt = this.promptBuilder.buildMasteryCheckPrompt(concept.name, conceptId);
      const messages = this.buildConversationContext(session);

      const parsed = await this.healer.chatWithEmptyContentHealing(
        this.sessionSlug,
        systemPrompt,
        [
          ...messages,
          { role: 'user', content: prompt },
        ],
        0.5,
        1500,
        getToolDefinitionsForPhase('mastery-check'),
        true,
        (response) => this.parser.parseStructuredResponse(response),
      );

      let message = this.parser.buildTutorMessageFromParsed(this.sessionSlug, parsed);

      // Inject conceptId if the LLM omitted it, so round-counting works reliably.
      if (message.question && !message.question.conceptId) {
        message = {
          ...message,
          question: { ...message.question, conceptId },
        };
      }

      // Only mark as mastery check if the LLM actually called provide_guidance.
      // If it returned plain-text fallback, treat it as a regular question so
      // handleMasteryCheckFlow does not mistakenly trigger an assessment.
      if (message.question && parsed.tool === 'provide_guidance') {
        message = { ...message, question: { ...message.question, isMasteryCheck: true } };
      }

      return message;
    });
  }

  async stepAssessMastery(session: SessionState, conceptId: string): Promise<{ message: TutorMessage; dimensions: MasteryDimension }> {
    this.tracer?.engineStep(this.sessionSlug, 'stepAssessMastery', { conceptId });
    return this.withPhase('mastery_check', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const concept = session.concepts.find(c => c.id === conceptId);
      if (!concept) throw new Error(`Concept ${conceptId} not found`);

      const prompt = this.promptBuilder.buildMasteryAssessPrompt(concept.name);
      const messages = this.buildConversationContext(session);

      const parsed = await this.healer.chatWithEmptyContentHealing(
        this.sessionSlug,
        systemPrompt,
        [
          ...messages,
          { role: 'user', content: prompt },
        ],
        0.5,
        1500,
        getToolDefinitionsForPhase('mastery-assess'),
        true,
        (response) => this.parser.parseStructuredResponse(response),
      );

      let message = this.parser.buildTutorMessageFromParsed(this.sessionSlug, parsed);

      // Mark assess_mastery feedback so handleMasteryCheckFlow knows the check
      // is complete and can continue to normal teaching instead of re-running
      // another mastery check.
      if (message.question) {
        message = { ...message, question: { ...message.question, isMasteryCheck: true } };
      }

      const dimensions: MasteryDimension = parsed.masteryCheck || {
        correctness: false,
        explanationDepth: false,
        novelApplication: false,
        conceptDiscrimination: false,
      };

      return { message, dimensions };
    });
  }

  async stepPracticeTask(session: SessionState, conceptId: string): Promise<TutorMessage> {
    this.tracer?.engineStep(this.sessionSlug, 'stepPracticeTask', { conceptId });
    return this.withPhase('practice_task', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const concept = session.concepts.find(c => c.id === conceptId);
      if (!concept) throw new Error(`Concept ${conceptId} not found`);

      const prompt = `学生已展示对 "${concept.name}" 的掌握。现在布置一个小练习任务（2-5 分钟）来应用这个概念。选项：
1. 写一个笔记中示例的变体
2. 找出并修复一个关于此概念的声明中的故意错误
3. 用他们自己领域的例子来解释这个概念

要求具体且贴合此概念。

CRITICAL: 你必须调用 provide_guidance 工具。不要输出纯文本——纯文本会被系统忽略。`;
      const messages = this.buildConversationContext(session);
      const parsed = await this.healer.chatWithEmptyContentHealing(
        this.sessionSlug,
        systemPrompt,
        [
          ...messages,
          { role: 'user', content: prompt },
        ],
        0.7,
        2000,
        getToolDefinitionsForPhase('practice'),
        true,
        (response) => this.parser.parseStructuredResponse(response),
      );

      let tutorMsg = this.parser.buildTutorMessageFromParsed(this.sessionSlug, parsed);

      if (!tutorMsg.content?.trim() && !tutorMsg.question) {
        tutorMsg.content = '...';
      }

      return tutorMsg;
    });
  }

  async stepReviewQuestion(session: SessionState, concept: ConceptState): Promise<TutorMessage> {
    this.tracer?.engineStep(this.sessionSlug, 'stepReviewQuestion', { conceptId: concept.id });
    return this.withPhase('review', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const prompt = `概念 "${concept.name}" 的快速复习问题（上次复习间隔：${formatInterval(concept.reviewInterval)}）。只问一个快速问题。如果回答正确，认可并加倍间隔。如果答错，记录挫折。`;
      const messages = this.buildConversationContext(session);

      const parsed = await this.healer.chatWithEmptyContentHealing(
        this.sessionSlug,
        systemPrompt,
        [
          ...messages,
          { role: 'user', content: prompt },
        ],
        0.5,
        500,
        getToolDefinitionsForPhase('teaching'),
        true,
        (response) => this.parser.parseStructuredResponse(response),
      );

      let tutorMsg = this.parser.buildTutorMessageFromParsed(this.sessionSlug, parsed);

      if (!tutorMsg.content?.trim() && !tutorMsg.question) {
        tutorMsg.content = '...';
      }

      return tutorMsg;
    });
  }

  updateMasteryFromCheck(
    dimensions: MasteryDimension,
    currentScore: number,
  ): { passed: boolean; newScore: number } {
    const dimensionScore = [
      dimensions.correctness,
      dimensions.explanationDepth,
      dimensions.novelApplication,
      dimensions.conceptDiscrimination,
    ].filter(Boolean).length / 4 * 100;

    // Weight the new evaluation more heavily so strong performances reach
    // the mastery threshold faster. A perfect 100% on the first check
    // yields 85%, enough to pass the default 80% threshold.
    const newScore = Math.round(currentScore * 0.15 + dimensionScore * 0.85);
    const passed = newScore >= 80;
    return { passed, newScore };
  }

  private withContentFallback(msg: TutorMessage, fallback = '...'): TutorMessage {
    if (!msg.content?.trim() && !msg.question) {
      return { ...msg, content: fallback };
    }
    return msg;
  }
}
