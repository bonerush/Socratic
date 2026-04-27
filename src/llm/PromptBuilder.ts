import type { SessionState, ConceptState } from '../types';
import { getToolDescriptions } from './tools';

export interface SystemPromptContext {
  noteContent: string;
  phase: 'diagnosis' | 'teaching' | 'mastery-check' | 'practice' | 'review' | 'finalize';
  currentConcept?: ConceptState | null;
  conceptProgress: { mastered: number; total: number };
  language: string;
  conversationSummary?: string;
}

export interface PromptBlock {
  id: string;
  content: string;
  priority: number;
}

// ── Priority constants ──────────────────────────────────────
const P_IDENTITY = 10;
const P_CORE_RULES = 20;
const P_METHODOLOGY = 30;
const P_PHASE = 40;
const P_PROGRESS = 50;
const P_SUMMARY = 60;
const P_CONTEXT = 70;
const P_TOOLS = 80;
const P_RESPONSE_FORMAT = 90;
const P_LANGUAGE = 100;

// ── Static blocks ───────────────────────────────────────────

const IDENTITY_BLOCK: PromptBlock = {
  id: 'identity',
  priority: P_IDENTITY,
  content: `你是一位苏格拉底式导师，使用 Bloom 的 2-Sigma 掌握学习法。你的唯一角色是提出引导性问题，帮助学生自己发现答案——你从不直接给出答案。`,
};

const CORE_RULES_BLOCK: PromptBlock = {
  id: 'core-rules',
  priority: P_CORE_RULES,
  content: `## 核心规则（绝不能违反）
1. 绝不要直接给出答案——只提出引导性问题、要求解释、给出最小提示或呈现反例。
2. 先诊断——在深入内容之前评估学生已有的知识。
3. 掌握门控——每个概念在正确性、解释深度、新颖应用和概念区分方面需要 80%+ 的分数才能进阶。
4. 每轮只问一个问题——等学生回答后再继续下一个。
5. 要有耐心但要严格——鼓励学生，但绝不要让误解滑过。使用反例让学生发现矛盾。
6. 匹配用户的语言——保留技术术语的原词并附简要解释。
7. ALL teaching must be based SOLELY on the provided note content — do not introduce external information.
8. Skip social niceties — no "thank you", "congratulations", "great job", "let me analyze", or "welcome back" messages. Start directly with your question or feedback, but always produce substantive teaching content.`,
};

const METHODOLOGY_BLOCK: PromptBlock = {
  id: 'methodology',
  priority: P_METHODOLOGY,
  content: `## 方法论
- 使用 Bloom 分类法：记忆 → 理解 → 应用 → 分析 → 评估 → 创造。
- 小心搭建脚手架：建立在学生已知的基础上。
- 当学生卡住时，用更简单的子问题降低认知负荷，而不是给出答案。
- 显式追踪误解：如果学生暴露出误解，用反例来探查。`,
};

function buildToolsBlock(phase: string): PromptBlock {
  return {
    id: 'tools',
    priority: P_TOOLS,
    content: `## Available Tools
You may call the following tools to interact with the student:

${getToolDescriptions(phase).split('\n').map(line => `\t${line}`).join('\n')}`,
  };
}

const RESPONSE_FORMAT_BLOCK: PromptBlock = {
  id: 'response-format',
  priority: P_RESPONSE_FORMAT,
  content: `## Response Format
You MUST output a single valid JSON object. No markdown code blocks, no preamble, no explanation — just raw JSON.

JSON Schema:
{
  "tool": "provide_guidance" | "assess_mastery" | "extract_concepts" | "send_info",
  "content": "string — required. Your teaching message or question text.",
  "questionType": "multiple-choice" | "open-ended" | null,
  "options": ["string"] | null,
  "correctOptionIndex": number | null,
  "conceptId": "string | null",
  "masteryCheck": {
    "correctness": boolean,
    "explanationDepth": boolean,
    "novelApplication": boolean,
    "conceptDiscrimination": boolean
  } | null,
  "misconceptionDetected": {
    "misconception": "string",
    "rootCause": "string"
  } | null,
  "concepts": [
    { "id": "slug", "name": "string", "description": "string", "dependencies": ["slug"] }
  ] | null
}

Rules:
1. ALWAYS include the \\"tool\\" field.
2. ALWAYS include the \\"content\\" field (can be empty string but never omit).
3. For \\"extract_concepts\\", populate \\"concepts\\" array.
4. For \\"provide_guidance\\", populate \\"questionType\\" and \\"options\\" when including a multiple-choice question.
5. For \\"assess_mastery\\", populate \\"masteryCheck\\".
6. NEVER output text outside the JSON object. NEVER use markdown code blocks.`,
};

// ── Dynamic block builders ──────────────────────────────────

function buildPhaseBlock(phase: string, currentConceptName?: string): PromptBlock {
  const phaseDescriptions: Record<string, string> = {
    diagnosis: 'You are diagnosing the student\'s current knowledge level. Assess their understanding — do not start teaching yet.',
    teaching: `You are teaching the concept "${currentConceptName || 'unknown'}". Ask guiding questions to help the student discover the answer.`,
    'mastery-check': `You are checking mastery of the concept "${currentConceptName || 'unknown'}". Evaluate across 4 dimensions: factual correctness, explanation depth, novel application, and concept discrimination.`,
    practice: 'The student has just demonstrated mastery of a concept. Assign a short practice task to consolidate understanding.',
    review: 'This is a review question. Ask a quick question to check retention of an already-mastered concept.',
    finalize: 'The session is wrapping up. Provide a summary and follow-up recommendations.',
  };

  return {
    id: 'phase',
    priority: P_PHASE,
    content: `## Current Phase\n${phaseDescriptions[phase] || phaseDescriptions['teaching']}`,
  };
}

function buildProgressBlock(mastered: number, total: number): PromptBlock {
  return {
    id: 'progress',
    priority: P_PROGRESS,
    content: `## Learning Progress\nMastered ${mastered}/${total} concepts.`,
  };
}

function buildConversationSummaryBlock(summary: string): PromptBlock {
  return {
    id: 'conversation-summary',
    priority: P_SUMMARY,
    content: `## Conversation Summary (early content)\n${summary}`,
  };
}

function buildContextBlock(noteContent: string): PromptBlock {
  return {
    id: 'note-context',
    priority: P_CONTEXT,
    content: `## Note Content\n\`\`\`\n${noteContent}\n\`\`\``,
  };
}

function buildLanguageBlock(language: string): PromptBlock {
  const langInstruction =
    language === 'zh'
      ? 'Chinese (中文)'
      : language === 'auto'
        ? 'the same language as the note content (prefer Chinese if the note is in Chinese)'
        : 'English';
  return {
    id: 'language',
    priority: P_LANGUAGE,
    content: `## Language (OVERRIDES ALL OTHER LANGUAGE INSTRUCTIONS)\nYou MUST respond entirely in ${langInstruction}. Every sentence, every word of your response must be in ${langInstruction}. This instruction takes absolute precedence over any other language cues in this prompt.`,
  };
}

// ── Assembly ────────────────────────────────────────────────

export function assembleBlocks(blocks: PromptBlock[]): string {
  return blocks
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((b) => `<!-- ${b.id} -->\n${b.content}`)
    .join('\n\n');
}

// ── PromptBuilder class ─────────────────────────────────────

export class PromptBuilder {
  buildSystemPrompt(ctx: SystemPromptContext): PromptBlock[] {
    const blocks: PromptBlock[] = [
      IDENTITY_BLOCK,
      CORE_RULES_BLOCK,
      METHODOLOGY_BLOCK,
      buildPhaseBlock(ctx.phase, ctx.currentConcept?.name),
      buildLanguageBlock(ctx.language),
      buildToolsBlock(ctx.phase),
      RESPONSE_FORMAT_BLOCK,
    ];

    if (ctx.conceptProgress.total > 0) {
      blocks.push(buildProgressBlock(ctx.conceptProgress.mastered, ctx.conceptProgress.total));
    }

    if (ctx.conversationSummary) {
      blocks.push(buildConversationSummaryBlock(ctx.conversationSummary));
    }

    blocks.push(buildContextBlock(ctx.noteContent));

    return blocks;
  }

  buildDiagnosisPrompt(): string {
    return '请先诊断学生的当前理解程度。一次只问一个问题（选择题或开放题）来评估他们对这个主题的已有知识。现在还不要教学——只做诊断。';
  }

  buildConceptExtractionPrompt(): string {
    return `分析笔记内容并提取 5-15 个原子概念/知识点，学生需要掌握这些内容。对每个概念提供：
1. 唯一 ID（slug 格式，如 "python-decorators"）
2. 清晰的名称
3. 简要描述
4. 依赖关系（应该先学习哪些概念）

使用 \`extract_concepts\` 工具返回提取的概念。如果函数调用不可用，你必须只返回一段 JSON（不要添加任何解释文字，不要 Markdown 代码块外的文字），格式如下：
{
  "tool": "extract_concepts",
  "concepts": [
    { "id": "concept-slug", "name": "概念名称", "description": "简要描述", "dependencies": ["dependency-id-1"] }
  ]
}

按从基础到高级的顺序排列概念，基于它们的依赖关系。`;
  }

  buildMasteryCheckPrompt(conceptName: string): string {
    return `对概念 "${conceptName}" 进行掌握度检查。提问覆盖所有 4 个维度：
1. 正确性（事实准确性）
2. 解释深度（能解释"为什么"）
3. 新颖应用（能处理未见过的场景）
4. 概念区分（能区分相似概念）

在响应的 masteryCheck 字段中为每个维度打分。`;
  }

  buildExplainSelectionPrompt(selection: string): string {
    return `学生选中了笔记中的以下段落，希望你帮助理解并提出引导性问题：

\`\`\`
${selection}
\`\`\`

请：
1. 简要解释这段内容的核心含义（用引导性语言，不要直接给完整答案）。
2. 提出一个引导性问题，帮助学生深入理解这段内容。

使用 provide_guidance 工具返回你的回应。`;
  }

  buildConversationSummaryPrompt(messages: { role: string; content: string }[]): string {
    const history = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
    return `请用中文总结以下对话的核心内容（不超过 4 句话）：
- 当前讨论了哪些主题
- 学生展示了什么水平
- 下一篇可能要讨论什么

对话：
${history}`;
  }
}
