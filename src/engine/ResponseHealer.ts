import { LLMService, type LLMResponse } from '../llm/LLMService';
import { type ToolDefinition } from '../llm/tools';
import { withRetry } from '../utils/common';
import { containsValidJson } from '../utils/json';
import type { Tracer } from '../debug/Tracer';
import type { LLMStructuredResponse } from './ResponseParser';

const MAX_RETRIES = 2;

const PREAMBLE_PATTERNS = [
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

function isPreamble(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return PREAMBLE_PATTERNS.some(p => p.test(trimmed));
}

/**
 * Detect whether the model has echoed system-prompt instructions back to
 * the user. Some weaker models repeat rules, schema descriptions, or tool
 * definitions instead of generating their own teaching content.
 */
function containsSystemPromptLeakage(text: string): boolean {
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

export class ResponseHealer {
  constructor(
    private llm: LLMService,
    private tracer: Tracer | null = null,
  ) {}

  /**
   * Chat with automatic self-correction for preamble/empty/invalid outputs.
   * When the model returns preamble text instead of structured data, the
   * bad output is added to the conversation history along with a correction
   * prompt, and the request is retried.
   */
  async chatWithSelfCorrection(
    sessionSlug: string,
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
      const isPre = !hasToolCall && !hasValidJson && isPreamble(content);
      const isEmpty = !hasToolCall && !hasValidJson && !content;
      const isLeakage = containsSystemPromptLeakage(content);

      if (!isPre && !isEmpty && !isLeakage) {
        return response;
      }

      const issue = isLeakage ? 'system-prompt-leakage' : isEmpty ? 'empty-response' : 'preamble-text';
      this.tracer?.selfCorrection(sessionSlug, attempt, issue, content);

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
  async chatWithEmptyContentHealing(
    sessionSlug: string,
    systemPrompt: string,
    baseMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    temperature: number,
    maxTokens: number,
    tools: ToolDefinition[] | undefined,
    jsonMode: boolean,
    parseFn: (response: LLMResponse) => LLMStructuredResponse,
  ): Promise<LLMStructuredResponse> {
    let response = await this.chatWithSelfCorrection(sessionSlug, systemPrompt, baseMessages, temperature, maxTokens, tools, jsonMode);
    let parsed = parseFn(response);

    // One extra healing attempt (chatWithSelfCorrection already retried 2×).
    const isExtractEmpty = parsed.tool === 'extract_concepts' && (!parsed.concepts || parsed.concepts.length === 0);
    const isContentEmpty = parsed.tool !== 'extract_concepts' && !parsed.content?.trim();
    const isLeakage = containsSystemPromptLeakage(parsed.content || '');
    const looksLikeQuestion = /[?？]/.test(parsed.content || '');
    const impliesMultipleChoice = /以下哪个|哪一个|请选择|选项|方案|选择/i.test(parsed.content || '');
    const isMissingOptions = looksLikeQuestion && impliesMultipleChoice && !parsed.options && parsed.questionType !== 'open-ended';

    if (isExtractEmpty || isContentEmpty || isLeakage || isMissingOptions) {
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

      this.tracer?.healingAttempt(sessionSlug, reason, correction);

      const correctionMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...baseMessages,
        { role: 'assistant', content: response.content || JSON.stringify(parsed) },
        { role: 'user', content: correction },
      ];

      response = await this.chatWithSelfCorrection(sessionSlug, systemPrompt, correctionMessages, temperature, maxTokens, tools, jsonMode);
      parsed = parseFn(response);
    }

    // Final guard: if the model still returned empty content after healing,
    // inject a safe default so the UI never shows "...".
    if (parsed.tool !== 'extract_concepts' && !parsed.content?.trim()) {
      parsed.content = '请简单描述一下你对这个主题的了解，我会根据你的回答提出下一个问题。';
    }

    return parsed;
  }
}
