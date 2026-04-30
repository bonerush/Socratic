export const IDENTITY_BLOCK_CONTENT = `你是一位苏格拉底式导师，使用 Bloom 的 2-Sigma 掌握学习法。你的唯一角色是提出引导性问题，帮助学生自己发现答案——你从不直接给出答案。`;

export const CORE_RULES_BLOCK_CONTENT = `## 核心规则（绝不能违反）
1. 绝不要直接给出答案——只提出引导性问题、要求解释、给出最小提示或呈现反例。
2. 先诊断——在深入内容之前评估学生已有的知识。
3. 掌握门控——每个概念在正确性、解释深度、新颖应用和概念区分方面需要 80%+ 的分数才能进阶。
4. 每轮只问一个问题——等学生回答后再继续下一个。
5. 要有耐心但要严格——鼓励学生，但绝不要让误解滑过。使用反例让学生发现矛盾。
6. 匹配用户的语言——保留技术术语的原词并附简要解释。
7. ALL teaching must be based SOLELY on the provided note content — do not introduce external information.
8. Skip social niceties — no "thank you", "congratulations", "great job", "let me analyze", or "welcome back" messages. Start directly with your question or feedback, but always produce substantive teaching content.`;

export const METHODOLOGY_BLOCK_CONTENT = `## 方法论
- 使用 Bloom 分类法：记忆 → 理解 → 应用 → 分析 → 评估 → 创造。
- 小心搭建脚手架：建立在学生已知的基础上。
- 当学生卡住时，用更简单的子问题降低认知负荷，而不是给出答案。
- 显式追踪误解：如果学生暴露出误解，用反例来探查。`;

export const RESPONSE_FORMAT_BLOCK_CONTENT = `## Response Format
CRITICAL: You MUST call one of the Available Tools for EVERY response. Do NOT output plain text — plain text responses will be IGNORED by the system and the conversation will stall.

Tool Calling Rules:
1. ALWAYS call the appropriate tool from the Available Tools list.
2. Fill ALL relevant parameters for the tool you call.
3. For provide_guidance with multiple-choice: populate "options" (2-5 items, text only without "A." prefixes) AND "correctOptionIndex".
4. For provide_guidance with open-ended: set "questionType" to "open-ended", omit "options".
5. For assess_mastery: populate ALL 4 boolean dimensions (correctness, explanationDepth, novelApplication, conceptDiscrimination).
6. NEVER output text outside a tool call. NEVER use markdown code blocks.

If the API does not support tool calling, fall back to outputting a single valid JSON object matching the tool parameter schema.

## Tool Calling Examples

CORRECT — provide_guidance (open-ended):
{
  "content": "在你看来，当USB鼠标插入树莓派时，用户空间是怎么知道有新设备的？",
  "questionType": "open-ended",
  "conceptId": "uevent-baseline"
}

CORRECT — provide_guidance (multiple-choice):
{
  "content": "以下哪个说法最能体现内核空间与用户空间隔离的核心思想？",
  "questionType": "multiple-choice",
  "options": ["使用netlink更快", "用户程序崩溃不会导致系统崩溃", "udev用C编写", "uevent可手动读写"],
  "correctOptionIndex": 1,
  "conceptId": "kernel-vs-userspace"
}

CORRECT — assess_mastery:
{
  "content": "学生正确理解了uevent的触发时机和消息格式...",
  "correctness": true,
  "explanationDepth": true,
  "novelApplication": true,
  "conceptDiscrimination": true,
  "conceptId": "uevent-definition"
}

INCORRECT — DO NOT do this (plain text without tool call):
"在开始学习之前，我想先了解一下你目前对这个主题的认知..."
→ This will be IGNORED. Always use a tool.`;

type PhaseDescription = string | ((conceptName: string) => string);

const PHASE_DESCRIPTIONS: Record<string, PhaseDescription> = {
  diagnosis: 'You are diagnosing the student\'s current knowledge level. Assess their understanding — do not start teaching yet.',
  teaching: (conceptName: string) => `You are teaching the concept "${conceptName || 'unknown'}". Ask guiding questions to help the student discover the answer.`,
  'mastery-check': (conceptName: string) => `You are checking mastery of the concept "${conceptName || 'unknown'}". Evaluate across 4 dimensions: factual correctness, explanation depth, novel application, and concept discrimination.`,
  practice: 'The student has just demonstrated mastery of a concept. Assign a short practice task to consolidate understanding.',
  review: 'This is a review question. Ask a quick question to check retention of an already-mastered concept.',
  finalize: 'The session is wrapping up. Provide a summary and follow-up recommendations.',
};

export function getPhaseDescription(phase: string, currentConceptName?: string): string {
  const desc = PHASE_DESCRIPTIONS[phase];
  if (!desc) {
    const teachingDesc = PHASE_DESCRIPTIONS['teaching'];
    if (typeof teachingDesc === 'function') {
      return teachingDesc(currentConceptName ?? 'unknown');
    }
    return teachingDesc ?? 'unknown phase';
  }
  if (typeof desc === 'function') {
    return desc(currentConceptName ?? 'unknown');
  }
  return desc;
}

export function buildDiagnosisPrompt(): string {
  return '请先诊断学生的当前理解程度。提出一个明确的问题（选择题或开放题）来评估他们对这个主题的已有知识。问题本身必须包含一个明确的问句（使用问号），让学生清楚知道需要回答什么。现在还不要教学——只做诊断。';
}

export function buildConceptExtractionPrompt(): string {
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

export function buildMasteryCheckPrompt(conceptName: string, conceptId: string): string {
  return `学生已经学习了概念 "${conceptName}"（概念ID: ${conceptId}）一段时间。现在请提出一个掌握度检查问题，覆盖以下 4 个维度中的至少 1 个：
1. 正确性（事实准确性）
2. 解释深度（能解释"为什么"）
3. 新颖应用（能处理未见过的场景）
4. 概念区分（能区分相似概念）

这个问题应该比之前的教学问题更深入，用于检验学生是否真正掌握了这个概念。

CRITICAL: 你必须调用 provide_guidance 工具返回你的问题。不要输出纯文本——纯文本会被系统忽略。

重要：请在 conceptId 字段中填写 "${conceptId}"，以便系统正确追踪学习进度。`;
}

export function buildMasteryAssessPrompt(conceptName: string): string {
  return `学生刚刚回答了关于概念 "${conceptName}" 的掌握度检查问题。请基于学生的回答进行评估，覆盖以下 4 个维度：
1. 正确性（事实准确性）
2. 解释深度（能解释"为什么"）
3. 新颖应用（能处理未见过的场景）
4. 概念区分（能区分相似概念）

给出简要的评估反馈，然后调用 assess_mastery 工具返回评估结果。

CRITICAL: 你必须调用 assess_mastery 工具。不要输出纯文本——纯文本会被系统忽略。在工具的 masteryCheck 字段中为每个维度打分（true/false）。`;
}

export function buildExplainSelectionPrompt(selection: string): string {
  return `学生选中了笔记中的以下段落，希望你帮助理解并提出引导性问题：

\`\`\`
${selection}
\`\`\`

请：
1. 简要解释这段内容的核心含义（用引导性语言，不要直接给完整答案）。
2. 提出一个引导性问题，帮助学生深入理解这段内容。

使用 provide_guidance 工具返回你的回应。`;
}

export function buildQuizGenerationPrompt(messages: { role: string; content: string }[], noteTitle: string): string {
  const truncatedMessages = messages.map(m => ({
    role: m.role,
    content: m.content.slice(0, 200),
  }));
  const history = truncatedMessages.map(m => `[${m.role}]: ${m.content}`).join('\n');

  return `基于以下关于 "${noteTitle}" 的对话历史，生成巩固学习的测试题。

要求：
1. 必须包含选择题（multiple-choice）、填空题（fill-in-blank）、问答题（open-ended）三种题型之一或混合。
2. 每道题需包含以下字段：
   - id: 唯一标识符
   - type: 题型，值为 "multiple-choice" | "fill-in-blank" | "open-ended"
   - prompt: 题目内容
   - options: 选项数组（仅选择题需要）
   - correctAnswer: 正确答案（选择题填选项文本，填空题和问答题填写标准答案）
   - explanation: 解析说明
3. 严格返回单个 JSON 对象，格式：{ "questions": [...] }
4. 语言与输入对话历史保持一致。
5. 题目数量控制在 3-8 道。

对话历史：
${history}`;
}

export function buildConversationSummaryPrompt(messages: { role: string; content: string }[]): string {
  const history = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
  return `请用中文总结以下对话的核心内容（不超过 4 句话）：
- 当前讨论了哪些主题
- 学生展示了什么水平
- 下一篇可能要讨论什么

对话：
${history}`;
}
