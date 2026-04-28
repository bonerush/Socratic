import { type TutorMessage, type Question } from '../types';
import { type ToolCall, validateToolCalls } from '../llm/tools';
import { tryParseJson, extractBalancedJsonObjects } from '../utils/json';
import { generateId } from '../utils/common';
import type { Tracer } from '../debug/Tracer';

export interface ExtractedConcept {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
}

export interface ConceptExtractionResponse {
  concepts: ExtractedConcept[];
}

export interface LLMStructuredResponse {
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

export class ResponseParser {
  constructor(private tracer: Tracer | null = null) {}

  parseStructuredResponse(response: { content: string; toolCalls?: ToolCall[] }): LLMStructuredResponse {
    // Path 1: validated tool calls from the LLM
    if (response.toolCalls && response.toolCalls.length > 0) {
      const validated = validateToolCalls(response.toolCalls);
      if (validated.valid.length > 0) {
        const first = validated.valid[0]!;
        return this.buildToolResponseWithFallback(first.name, first.args, response.content);
      }

      // Path 1b: lenient fallback — if validation failed, still try to parse
      // the first tool call directly (matches old behaviour where we JSON.parse
      // without validation). This keeps us resilient to LLMs that return
      // slightly malformed parameters.
      const firstCall = response.toolCalls[0]!;
      try {
        const args = JSON.parse(firstCall.function.arguments) as Record<string, unknown>;
        return this.buildToolResponseWithFallback(firstCall.function.name, args, response.content);
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
    this.tracer?.parsedResult('unknown', { ...fallbackResult, _source: 'fallback' });
    return fallbackResult;
  }

  private buildToolResponseWithFallback(
    toolName: string,
    args: Record<string, unknown>,
    rawContent?: string,
  ): LLMStructuredResponse {
    const parsed = this.buildResponseFromValidatedTool(toolName, args);
    // When the tool call left content empty but the message body has text,
    // borrow it. For extract_concepts an empty content is valid (the payload
    // is in the concepts array), so skip that tool.
    if (
      parsed.tool !== 'extract_concepts' &&
      !parsed.content?.trim() &&
      rawContent?.trim()
    ) {
      parsed.content = rawContent.trim();
    }
    return parsed;
  }

  buildResponseFromValidatedTool(
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

    const a = args;
    switch (toolName) {
      case 'provide_guidance':
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
      case 'assess_mastery':
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
      case 'extract_concepts':
        return {
          ...base,
          content: '',
          concepts: Array.isArray(a.concepts) ? a.concepts : undefined,
        };
      case 'send_info':
      default:
        return {
          ...base,
          content: String(a.content ?? ''),
          conceptId: typeof a.conceptId === 'string' ? a.conceptId : null,
        };
    }
  }

  buildTutorMessageFromParsed(sessionSlug: string, parsed: LLMStructuredResponse): TutorMessage {
    this.tracer?.parsedResult(sessionSlug, { ...parsed, _source: 'buildTutorMessage' });
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
  extractOptionsFromContent(content: string): { options: string[]; correctOptionIndex?: number } | null {
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

  inferMessageType(parsed: LLMStructuredResponse): TutorMessage['type'] {
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

  tryExtractConceptsFromText(text: string): ExtractedConcept[] {
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
}
