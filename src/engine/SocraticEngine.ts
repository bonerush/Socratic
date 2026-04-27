import { type SessionState, type TutorMessage, type Question, type ConceptState, type SelfAssessmentLevel, type MasteryDimension } from '../types';
import { LLMService, type LLMResponse } from '../llm/LLMService';
import { PromptBuilder, assembleBlocks, type SystemPromptContext } from '../llm/PromptBuilder';
import { type ToolCall, type ToolDefinition, validateToolCalls, getToolDefinitionsForPhase } from '../llm/tools';
import { generateId } from '../utils/helpers';
import { containsValidJson, tryParseJson, extractBalancedJsonObjects } from '../utils/json';
import { withRetry } from '../utils/async';
import { formatInterval } from '../utils/text';
import type { Tracer } from '../debug/Tracer';

const MAX_CONTEXT_MESSAGES = 15;
const SUMMARY_THRESHOLD = 12;
const MAX_RETRIES = 2;

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
  tool: 'provide_guidance' | 'assess_mastery' | 'extract_concepts' | 'send_info';
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

  setTracer(tracer: Tracer | null): void {
    this.tracer = tracer;
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
      const rounds = session.messages.filter(m => {
        if (m.role !== 'tutor') return false;
        // Only count questions explicitly tagged with this conceptId.
        // Diagnosis-phase questions have no conceptId and must NOT count
        // toward a concept's teaching rounds.
        return m.question?.conceptId === current.id;
      }).length;
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

  async stepExplainSelection(session: SessionState, selection: string): Promise<TutorMessage> {
    this.tracer?.engineStep(this.sessionSlug, 'stepExplainSelection', { selectionLength: selection.length });
    return this.withPhase('explain_selection', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const prompt = this.promptBuilder.buildExplainSelectionPrompt(selection);
      const messages = this.buildConversationContext(session);

      const parsed = await this.chatWithEmptyContentHealing(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.7, 2000, getToolDefinitionsForPhase('teaching'));

      const tutorMsg = this.buildTutorMessageFromParsed(parsed);

      this.ensureContent(tutorMsg);
      return tutorMsg;
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

      const parsed = await this.chatWithEmptyContentHealing(systemPrompt, [
        ...messages,
        { role: 'user', content: diagnosisPrompt },
      ], 0.7, 2000, getToolDefinitionsForPhase('diagnosis'));

      const tutorMsg = this.buildTutorMessageFromParsed(parsed);

      // Guard: in diagnosis phase the model MUST use provide_guidance.
      // If it returns extract_concepts or another wrong tool, treat it as
      // malformed and inject a safe default so the user sees a real question.
      if (parsed.tool !== 'provide_guidance') {
        tutorMsg.content = '你对这个主题已经有哪些了解？请简单描述一下，我会根据你的回答提出下一个问题。';
        tutorMsg.type = 'question';
        tutorMsg.question = {
          id: generateId(),
          conceptId: '',
          type: 'open-ended',
          prompt: tutorMsg.content,
        };
      }

      // Guard: if the LLM described a scenario but didn't actually ask a question
      // (no question mark in content), append a direct question so the user knows
      // what to answer.
      const hasQuestionMark = /[?？]/.test(tutorMsg.content);
      if (!hasQuestionMark && tutorMsg.type !== 'info') {
        tutorMsg.content += '\n\n你对这个主题已经有哪些了解？请简单描述一下。';
        if (!tutorMsg.question) {
          tutorMsg.question = {
            id: generateId(),
            conceptId: '',
            type: 'open-ended',
            prompt: tutorMsg.content,
          };
          tutorMsg.type = 'question';
        }
      }

      this.ensureContent(tutorMsg);
      return tutorMsg;
    });
  }

  async stepExtractConcepts(session: SessionState): Promise<{ concepts: ExtractedConcept[] }> {
    this.tracer?.engineStep(this.sessionSlug, 'stepExtractConcepts');
    return this.withPhase('extract_concepts', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const extractionPrompt = this.promptBuilder.buildConceptExtractionPrompt();

      const response = await this.chatWithSelfCorrection(systemPrompt, [
        { role: 'user', content: extractionPrompt },
      ], 0.3, 2000, getToolDefinitionsForPhase('extract_concepts'));

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
    });
  }

  private tryExtractConceptsFromText(text: string): ExtractedConcept[] {
    const parsed = tryParseJson<Record<string, unknown>>(text);
    if (!parsed) return [];

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
    return [];
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
      const parsed = await this.chatWithEmptyContentHealing(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.7, 2000, getToolDefinitionsForPhase('teaching'));

      const tutorMsg = this.buildTutorMessageFromParsed(parsed);

      // Inject current conceptId if LLM omitted it, so round-counting works reliably.
      if (tutorMsg.question && !tutorMsg.question.conceptId && session.currentConceptId) {
        tutorMsg.question.conceptId = session.currentConceptId;
      }

      if (!tutorMsg.content?.trim() && !tutorMsg.question) {
        tutorMsg.content = '...';
      }

      return tutorMsg;
    });
  }

  async stepMasteryCheck(session: SessionState, conceptId: string): Promise<{ message: TutorMessage; dimensions: MasteryDimension }> {
    this.tracer?.engineStep(this.sessionSlug, 'stepMasteryCheck', { conceptId });
    return this.withPhase('mastery_check', async () => {
      const systemPrompt = this.buildContextAwareSystemPrompt(session);
      const concept = session.concepts.find(c => c.id === conceptId);
      if (!concept) throw new Error(`Concept ${conceptId} not found`);

      const prompt = this.promptBuilder.buildMasteryCheckPrompt(concept.name);
      const messages = this.buildConversationContext(session);

      const parsed = await this.chatWithEmptyContentHealing(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.5, 1500, getToolDefinitionsForPhase('mastery-check'));

      const message = this.buildTutorMessageFromParsed(parsed);
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
      const parsed = await this.chatWithEmptyContentHealing(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.7, 2000, getToolDefinitionsForPhase('practice'));

      const tutorMsg = this.buildTutorMessageFromParsed(parsed);

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
      const prompt = `概念 "${concept.name}" 的快速复习问题（上次复习间隔：${this.formatInterval(concept.reviewInterval)}）。只问一个快速问题。如果回答正确，认可并加倍间隔。如果答错，记录挫折。`;
      const messages = this.buildConversationContext(session);

      const parsed = await this.chatWithEmptyContentHealing(systemPrompt, [
        ...messages,
        { role: 'user', content: prompt },
      ], 0.5, 500, getToolDefinitionsForPhase('teaching'));

      const tutorMsg = this.buildTutorMessageFromParsed(parsed);

      if (!tutorMsg.content?.trim() && !tutorMsg.question) {
        tutorMsg.content = '...';
      }

      return tutorMsg;
    });
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

    // Weight the new evaluation more heavily so strong performances reach
    // the mastery threshold faster. A perfect 100% on the first check
    // yields 85%, enough to pass the default 80% threshold.
    concept.masteryScore = Math.round(concept.masteryScore * 0.15 + dimensionScore * 0.85);
    concept.lastReviewTime = Date.now();
    concept.selfAssessment = selfAssessment;

    const passed = concept.masteryScore >= 80;
    return { passed, newScore: concept.masteryScore };
  }

  // --- Self-Healing & Error Recovery ---

  private readonly PREAMBLE_PATTERNS = [
    /^我先/,
    /^好的[，,]/,
    /^让我/,
    /^现在/,
    /^接下来/,
    /^首先/,
    /^那么/,
    /^我来/,
    /^请稍等/,
    /^正在/,
    /^思考/,
    /^(我)?(要|会|将|来)(先|开始|进行)/,
    /^我(先|来|将|会|要)/,
    /^OK[，,]/i,
    /^Okay[，,]/i,
  ];

  private isPreamble(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;
    return this.PREAMBLE_PATTERNS.some(p => p.test(trimmed));
  }

  /**
   * Detect whether the model has echoed system-prompt instructions back to
   * the user. Some weaker models repeat rules, schema descriptions, or tool
   * definitions instead of generating their own teaching content.
   */
  private containsSystemPromptLeakage(text: string): boolean {
    if (!text.trim()) return false;
    const leakagePatterns = [
      /你是一位苏格拉底式导师/,
      /Bloom 的 2-Sigma/,
      /掌握学习法/,
      /核心规则（绝不能违反）/,
      /Response Format/i,
      /JSON Schema/i,
      /Available Tools/i,
      /provide_guidance\s*\|/,
      /assess_mastery\s*\|/,
      /extract_concepts\s*\|/,
      /send_info\s*\|/,
      /Parameters:/,
      /## 方法论/,
      /## Current Phase/,
      /## Learning Progress/,
    ];
    return leakagePatterns.some(p => p.test(text));
  }

  /**
   * Chat with automatic self-correction for preamble/empty/invalid outputs.
   * When the model returns preamble text instead of structured data, the
   * bad output is added to the conversation history along with a correction
   * prompt, and the request is retried.
   */
  private async chatWithSelfCorrection(
    systemPrompt: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    temperature: number,
    maxTokens: number,
    tools?: ToolDefinition[],
    jsonMode = true,
  ): Promise<LLMResponse> {
    const mutableMessages = [...messages];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await withRetry(() =>
        this.llm.chat(systemPrompt, mutableMessages, temperature, maxTokens, tools, jsonMode)
      );
      const content = response.content?.trim() || '';

      // Valid if: has tool calls, or contains valid JSON, or has non-preamble text
      // AND does not leak system-prompt instructions.
      const hasToolCall = response.toolCalls && response.toolCalls.length > 0;
      const hasValidJson = containsValidJson(content);
      const isPre = !hasToolCall && !hasValidJson && this.isPreamble(content);
      const isEmpty = !hasToolCall && !hasValidJson && !content;
      const isLeakage = this.containsSystemPromptLeakage(content);

      if (!isPre && !isEmpty && !isLeakage) {
        return response;
      }

      const issue = isLeakage ? 'system-prompt-leakage' : isEmpty ? 'empty-response' : 'preamble-text';
      this.tracer?.selfCorrection(this.sessionSlug, attempt, issue, content);

      if (attempt < MAX_RETRIES) {
        mutableMessages.push({ role: 'assistant', content: content || '(empty response)' });
        let correction = '你的输出格式不正确。你必须输出一个有效的JSON对象（不要markdown代码块，不要前言）。严格按照system prompt中的JSON Schema格式输出。';
        if (isLeakage) {
          correction = '你的回复包含了系统提示中的指令或示例文字。请只输出你自己的教学内容，不要重复系统提示中的任何规则、格式说明或示例。';
        }
        mutableMessages.push({
          role: 'user',
          content: correction,
        });
      }
    }

    // Return last response even if malformed — caller will use parse fallback
    return await withRetry(() =>
      this.llm.chat(systemPrompt, mutableMessages, temperature, maxTokens, tools, jsonMode)
    );
  }

  /**
   * An additional healing layer on top of chatWithSelfCorrection.
   * When the model returns a structurally valid response (valid tool call or
   * JSON) but with empty or leaked content, we feed the bad output back into
   * the conversation with a correction prompt and retry.
   *
   * Only retries once (on top of chatWithSelfCorrection's own retries) to
   * keep latency reasonable.
   */
  private async chatWithEmptyContentHealing(
    systemPrompt: string,
    baseMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    temperature: number,
    maxTokens: number,
    tools?: ToolDefinition[],
    jsonMode = true,
  ): Promise<LLMStructuredResponse> {
    let response = await this.chatWithSelfCorrection(systemPrompt, baseMessages, temperature, maxTokens, tools, jsonMode);
    let parsed = this.parseStructuredResponse(response);

    // One extra healing attempt (chatWithSelfCorrection already retried 2×).
    for (let attempt = 0; attempt < 1; attempt++) {
      const isExtractEmpty = parsed.tool === 'extract_concepts' && (!parsed.concepts || parsed.concepts.length === 0);
      const isContentEmpty = parsed.tool !== 'extract_concepts' && !parsed.content?.trim();
      const isLeakage = this.containsSystemPromptLeakage(parsed.content || '');
      const looksLikeQuestion = /[?？]/.test(parsed.content || '');
      const impliesMultipleChoice = /以下哪个|哪一个|请选择|选项|方案|选择/i.test(parsed.content || '');
      const isMissingOptions = looksLikeQuestion && impliesMultipleChoice && !parsed.options && parsed.questionType !== 'open-ended';

      if (!isExtractEmpty && !isContentEmpty && !isLeakage && !isMissingOptions) {
        return parsed;
      }

      let correction = '';
      const reason = isLeakage ? 'system-prompt-leakage' : isContentEmpty ? 'empty-content' : isMissingOptions ? 'missing-options' : 'empty-concepts';
      if (isLeakage) {
        correction = '你的回复包含了系统提示中的指令或示例文字。请只输出你自己的教学内容，不要重复系统提示中的任何规则、格式说明或示例。';
      } else if (isContentEmpty) {
        correction = '你的 content 字段为空。请重新生成完整、有意义的回复，确保 content 包含实际的问题或指导文本。';
      } else if (isMissingOptions) {
        correction = '你的消息中提到了"选择"或"哪个"，暗示这是一个选择题，但没有提供 options 数组。请重新调用 provide_guidance 工具，如果是选择题必须提供 options 数组（2-5个选项）和 correctOptionIndex；如果是开放性问题，请将 questionType 设为 "open-ended" 并去掉暗示选择的措辞。';
      } else if (isExtractEmpty) {
        correction = '你没有返回任何概念。请从笔记内容中提取 5-15 个原子概念，并填充 concepts 数组。';
      }

      this.tracer?.healingAttempt(this.sessionSlug, reason, correction);

      const correctionMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...baseMessages,
        { role: 'assistant', content: response.content || JSON.stringify(parsed) },
        { role: 'user', content: correction },
      ];

      response = await this.chatWithSelfCorrection(systemPrompt, correctionMessages, temperature, maxTokens, tools, jsonMode);
      parsed = this.parseStructuredResponse(response);
    }

    // Final guard: if the model still returned empty content after healing,
    // inject a safe default so the UI never shows "...".
    if (parsed.tool !== 'extract_concepts' && !parsed.content?.trim()) {
      parsed.content = '请简单描述一下你对这个主题的了解，我会根据你的回答提出下一个问题。';
    }

    return parsed;
  }

  // --- Parsing ---

  private parseStructuredResponse(response: { content: string; toolCalls?: ToolCall[] }): LLMStructuredResponse {
    // Path 1: validated tool calls from the LLM
    if (response.toolCalls && response.toolCalls.length > 0) {
      const validated = validateToolCalls(response.toolCalls);
      if (validated.valid.length > 0) {
        const first = validated.valid[0]!;
        const parsed = this.buildResponseFromValidatedTool(first.name, first.args);
        // When the tool call left content empty but the message body has text,
        // borrow it.  For extract_concepts an empty content is valid (the payload
        // is in the concepts array), so skip that tool.
        if (
          parsed.tool !== 'extract_concepts' &&
          !parsed.content?.trim() &&
          response.content?.trim()
        ) {
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
        if (
          parsed.tool !== 'extract_concepts' &&
          !parsed.content?.trim() &&
          response.content?.trim()
        ) {
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
      const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonText = codeBlock ? codeBlock[1]! : raw;
      // Use balanced brace extraction to correctly handle nested objects
      // (non-greedy regex \{[\s\S]*?\} would stop at the first inner \}).
      const candidates = extractBalancedJsonObjects(jsonText);
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(candidate) as LLMStructuredResponse;
          if (parsed.tool || parsed.content || parsed.concepts) return parsed;
        } catch {
          // Try next candidate
        }
      }
    } catch {
      // Fall through
    }

    // Path 3: Fallback
    const content = response.content?.trim();
    const fallbackResult: LLMStructuredResponse = {
      tool: 'send_info',
      content: content || '请继续思考并分享你的理解。',
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: null,
      masteryCheck: null,
      misconceptionDetected: null,
    };
    this.tracer?.parsedResult(this.sessionSlug, { ...fallbackResult, _source: 'fallback' });
    return fallbackResult;
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
      case 'provide_guidance': {
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
    this.tracer?.parsedResult(this.sessionSlug, { ...parsed, _source: 'buildTutorMessage' });
    let questionType = parsed.questionType || null;
    const content = parsed.content || '';
    let options = parsed.options;
    let correctOptionIndex = parsed.correctOptionIndex ?? undefined;

    // Fallback: if the LLM wrote A/B/C/D options in the text but forgot to
    // populate the structured fields, extract them automatically.
    if (!options || options.length === 0) {
      const extracted = this.extractOptionsFromContent(content);
      if (extracted) {
        options = extracted.options;
        correctOptionIndex = extracted.correctOptionIndex ?? correctOptionIndex;
        questionType = 'multiple-choice';
      }
    }

    // Guard: if the LLM returned plain text that looks like a question but
    // didn't call a tool or set questionType, treat it as an open-ended
    // question so the UI shows it as something the student can answer.
    if (!questionType && /[?？]/.test(content)) {
      questionType = 'open-ended';
    }

    const question: Question | undefined = questionType
      ? {
          id: generateId(),
          conceptId: parsed.conceptId || '',
          type: questionType,
          prompt: content,
          options: options || undefined,
          correctOptionIndex: correctOptionIndex ?? undefined,
        }
      : undefined;

    const type = this.inferMessageType({ ...parsed, questionType });

    return {
      id: generateId(),
      role: 'tutor',
      type,
      content,
      question,
      timestamp: Date.now(),
    };
  }

  /**
   * Extract multiple-choice options from message content when the LLM
   * writes them inline (e.g. "A. xxx\nB. xxx") but omits the structured
   * `options` array in the tool call.
   *
   * Supports formats like:
   *   A. xxx
   *   B、xxx
   *   C) xxx
   *   D xxx
   */
  private extractOptionsFromContent(content: string): { options: string[]; correctOptionIndex?: number } | null {
    const lines = content.split('\n');
    const options: string[] = [];
    const optionRegex = /^\s*([A-Da-d])[\.、。:：,，!！?？）\)\]\}\-\s]+\s*(.+)$/;
    const simpleRegex = /^\s*([A-Da-d])\s+(.+)$/;

    for (const line of lines) {
      const match = optionRegex.exec(line) || simpleRegex.exec(line);
      if (match && match[1] && match[2]) {
        const label = match[1].toUpperCase();
        const text = match[2].trim();
        const index = label.charCodeAt(0) - 65;
        if (index >= 0 && index < 4) {
          // Ensure array has enough slots
          while (options.length <= index) options.push('');
          options[index] = text;
        }
      }
    }

    if (options.length >= 2 && options.every(o => o.trim().length > 0)) {
      return { options };
    }
    return null;
  }

  private inferMessageType(parsed: LLMStructuredResponse): TutorMessage['type'] {
    if (parsed.tool === 'provide_guidance') {
      return parsed.questionType ? 'question' : 'feedback';
    }
    if (parsed.tool === 'assess_mastery') return 'feedback';
    if (parsed.tool === 'extract_concepts') return 'info';
    if (parsed.tool === 'send_info') return 'info';
    if (parsed.type) {
      if (parsed.type === 'check-complete') return 'info';
      return parsed.type as TutorMessage['type'];
    }
    return 'info';
  }

  private ensureContent(msg: TutorMessage, fallback = '...'): void {
    if (!msg.content?.trim() && !msg.question) {
      msg.content = fallback;
    }
  }

  private formatInterval(seconds: number): string {
    if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }
}
