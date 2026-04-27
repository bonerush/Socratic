# Socratic Note Tutor 项目架构文档

> 本文档详细描述了插件的整体流程：从用户打开辅导界面、会话管理、大语言模型调用、函数调用机制，到系统提示词的构建与响应解析。

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体流程概览](#2-整体流程概览)
3. [启动流程：从 Obsidian 到 React 界面](#3-启动流程从-obsidian-到-react-界面)
4. [开始辅导：核心会话流程](#4-开始辅导核心会话流程)
5. [会话阶段详解](#5-会话阶段详解)
6. [系统提示词构建](#6-系统提示词构建)
7. [LLM 函数调用机制](#7-llm-函数调用机制)
8. [响应解析与消息构建](#8-响应解析与消息构建)
9. [会话生命周期管理](#9-会话生命周期管理)
10. [数据流与状态同步](#10-数据流与状态同步)
11. [文件结构一览](#11-文件结构一览)

---

## 1. 项目概述

**Socratic Note Tutor** 是一个 Obsidian 插件，利用大语言模型（LLM）实现苏格拉底式教学法。用户可以在 Obsidian 中打开一篇笔记，插件会：

1. **诊断**：评估用户对该主题的已有知识
2. **提取概念**：从笔记内容中提取需要掌握的知识点
3. **提问教学**：通过苏格拉底式提问（而非直接给答案）引导用户学习
4. **掌握度检查**：多维度评估用户对概念的掌握程度
5. **练习任务**：概念掌握后安排实践任务
6. **间隔复习**：已掌握的概念到期后自动复习

---

## 2. 整体流程概览

```
用户点击 Ribbon 图标 / 命令
        │
        ▼
┌─────────────────────────────────────┐
│  ReactSocraticView                  │  ← Obsidian ItemView，挂载 React 应用
│  (SocraticApp + SocraticProvider)    │
└─────────┬───────────────────────────┘
          │ 点击"开始辅导"
          ▼
┌─────────────────────────────────────┐
│  main.ts (SocraticNoteTutor Plugin) │  ← 插件入口，协调一切
│                                     │
│  1. startTutoring()                 │
│     ├─ 获取笔记内容                  │
│     ├─ 检测语言                      │
│     └─ startNewSessionWithNote()    │
│                                     │
│  2. continueTutoring()  ← 循环入口  │
│     └─ 调用 engine 步骤方法          │
└──────────┬──────────────────────────┘
           │
           ▼
┌───────────────────────────────────────────────────────────┐
│  SocraticEngine (教学引擎)                                 │
│                                                           │
│  步骤方法（按阶段调用）:                                    │
│  ┌─ stepDiagnosis() ────────────────────────────────────┐ │
│  │  stepExtractConcepts()   stepAskQuestion()           │ │
│  │  stepMasteryCheck()      stepPracticeTask()          │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  每个步骤方法内部执行以下 7 步装配流程:                     │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 1. getPhase(session)   → 判断当前阶段               │  │
│  │ 2. buildContextAwareSystemPrompt(session)            │  │
│  │    → 收集上下文 → PromptBuilder.buildSystemPrompt() │  │
│  │    → 输出完整 system prompt                          │  │
│  │ 3. buildConversationContext(session)                 │  │
│  │    → 截断/摘要 → 最近 15 条消息                      │  │
│  │ 4. 拼接阶段专用 prompt（最后一条 user 消息）          │  │
│  │ 5. LLMService.chat(systemPrompt, messages, TOOLS)   │  │
│  │    → 组合 system + history + prompt + tools          │  │
│  │    → HTTP POST → LLM API                             │  │
│  │ 6. parseStructuredResponse(response)                 │  │
│  │    → tool_calls 优先 → JSON 降级 → 纯文本            │  │
│  │ 7. buildTutorMessageFromParsed(parsed)               │  │
│  │    → 生成 TutorMessage (含选择题选项)                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                    │                                       │
│  返回 TutorMessage  │                                       │
└─────────────────────┼─────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────┐
│  main.ts (回传处理)                  │
│                                     │
│  ├─ 消息添加到 session.messages[]    │
│  ├─ view.addMessage(msg)            │
│  │    → updateState() → React 渲染  │
│  ├─ sessionManager.saveSession()    │
│  │    → 持久化到 .socratic-sessions │
│  └─ continueTutoring() 继续循环     │
└─────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────┐
│  React 界面更新                      │
│  (useSyncExternalStore → 重新渲染)   │
│                                     │
│  ├─ MessageBubble 显示消息           │
│  ├─ OptionsBar 显示选择题按钮        │
│  ├─ TypingIndicator 消失            │
│  └─ ProgressPanel 更新进度           │
└─────────────────────────────────────┘
                      │
    用户输入文本 / 点击选项
                      │
                      ▼
┌─────────────────────────────────────┐
│  processUserResponse() /            │
│  processChoiceSelection()           │
│  → 添加 user 消息 → continueTutoring│
│  → 回到步骤 1，重新装配提示词        │
└─────────────────────────────────────┘
```

---

## 3. 启动流程：从 Obsidian 到 React 界面

### 3.1 插件加载 (`main.ts:24`)

```typescript
async onload(): Promise<void> {
  // 1. 加载设置
  await this.loadSettings();

  // 2. 初始化管理器
  this.sessionManager = new SessionManager(this.app.vault, ...);
  this.llmService = new LLMService(this.settings);
  this.engine = new SocraticEngine(this.llmService);

  // 3. 注册视图类型
  this.registerView(VIEW_TYPE_SOCRATIC, (leaf) =>
    new ReactSocraticView(leaf, this));

  // 4. 添加 Ribbon 图标（侧边栏大脑图标）
  this.addRibbonIcon('brain', 'Open Socratic Tutor', () => {
    this.activateView();
  });

  // 5. 添加命令
  this.addCommand({ id: 'open-socratic-tutor', ... });
  this.addCommand({ id: 'start-tutoring', ... });

  // 6. 自动打开视图
  this.activateView();
}
```

### 3.2 激活视图 (`main.ts:77`)

```typescript
async activateView(): Promise<void> {
  // 查找或创建视图 leaf
  let leaf = workspace.getLeavesOfType(VIEW_TYPE_SOCRATIC)[0];
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_SOCRATIC, active: true });
  }
  workspace.revealLeaf(leaf);
}
```

### 3.3 React 挂载 (`ReactSocraticView.ts:62`)

`ReactSocraticView` 继承 `ItemView`，在 `onOpen()` 中挂载 React 应用：

```typescript
async onOpen(): Promise<void> {
  this.root = createRoot(this.contentEl);
  this.root.render(
    React.createElement(StrictMode, null,
      React.createElement(SocraticApp, { view: this })
    )
  );
}
```

### 3.4 React 组件树

```
SocraticApp
  └── SocraticProvider (Context Provider)
       ├── Header: "苏格拉底笔记导师" + 状态
       ├── ProgressPanel (会话激活时显示)
       ├── Thread
       │    ├── Messages (消息列表)
       │    │    ├── MessageBubble (每条消息)
       │    │    │    ├── 内容文本
       │    │    │    └── OptionsBar (选择题选项按钮)
       │    │    └── TypingIndicator (思考中动画)
       │    └── Composer (文本输入框)
       ├── SessionResume (覆盖层对话框)
       └── SelfAssessment (覆盖层对话框)
```

### 3.5 状态同步机制

`ReactSocraticView` 充当 Obsidian 和 React 之间的桥梁，使用 **`useSyncExternalStore`** 模式：

```
ViewState (在 ReactSocraticView 中)
  ├── messages: TutorMessage[]       ← 消息列表
  ├── isProcessing: boolean           ← 是否正在处理
  ├── isSessionActive: boolean        ← 会话是否激活
  ├── sessionState: SessionState|null ← 完整会话状态
  ├── selfAssessment: {...}|null      ← 自评对话框 Promise
  └── sessionResume: {...}|null       ← 恢复对话框 Promise
```

- **`updateState(partial)`**：不可变更新状态，触发所有 listener
- **`subscribe(callback)`**：供 `useSyncExternalStore` 使用
- **`getViewState()`**：返回当前状态快照

`SocraticContext` 通过 `useSyncExternalStore` 订阅视图状态，并将 `plugin` 方法封装为 Context 回调：

```typescript
const onSendMessageFn = useCallback(async (text: string) => {
  view.setProcessing(true);
  await plugin.processUserResponse(text);
  view.setProcessing(false);
}, [view, plugin]);
```

---

## 4. 开始辅导：核心会话流程

### 4.1 触发入口

点击"开始辅导"按钮 → `onStartTutoring()` → `plugin.startTutoring()`

### 4.2 startTutoring() (`main.ts:141`)

```
startTutoring()
  │
  ├─ 检查 API Key → 无则报错
  ├─ 获取当前 Markdown 笔记内容
  ├─ 检查是否有已有会话
  │    ├─ 有 → 弹出 SessionResume 对话框
  │    │    ├─ "继续上次" → loadSession() → resumeSession()
  │    │    └─ "重新开始" → deleteSession()
  │    └─ 无 → 继续
  ├─ 检测语言 → engine.setLanguage()
  └─ startNewSessionWithNote(title, content)
       │
       ├─ 创建空白 SessionState
       ├─ 清空消息、激活 UI
       └─ runDiagnosis()
```

### 4.3 会话持续循环 (`continueTutoring`)

```
continueTutoring()
  │
  ├─ 判断阶段 ↓
  │
  ├─ [诊断阶段] concepts.length === 0
  │    ├─ stepDiagnosis() → LLM 提问诊断
  │    ├─ 用户回答 → continueTutoring()
  │    └─ 诊断轮次 ≥ 2 且回答数 ≥ 提问数 → extractConceptsAndBuildRoadmap()
  │
  ├─ [概念提取] 诊断完成
  │    ├─ stepExtractConcepts() → LLM 提取概念
  │    ├─ 保存概念列表、生成路线图 HTML
  │    └─ continueTutoring()
  │
  ├─ [教学阶段] 有未掌握概念
  │    ├─ 设置 currentConceptId
  │    ├─ stepAskQuestion() → LLM 提问
  │    ├─ 用户回答 → continueTutoring()
  │    └─ 同一概念轮次 ≥ 3 → runMasteryCheck()
  │
  ├─ [掌握度检查] 概念对话 ≥ 3 轮
  │    ├─ stepMasteryCheck() → LLM 评估 4 维度
  │    ├─ showSelfAssessment() → 用户自评
  │    ├─ updateMasteryFromCheck() → 计算分数
  │    ├─ 分数 ≥ 阈值 → status='mastered' → runPracticeTask()
  │    └─ 分数 < 阈值 → status='learning' → 继续教学
  │
  ├─ [练习任务] 已掌握概念
  │    ├─ stepPracticeTask() → LLM 布置练习
  │    └─ continueTutoring()
  │
  └─ [结束] 所有概念 mastered
       └─ finalizeSession()
            ├─ generateSessionOutputs()
            │    ├─ 路线图 HTML
            │    ├─ 进度摘要 HTML
            │    └─ 最终总结 HTML
            └─ updateLearnerProfile()
```

---

## 5. 会话阶段详解

### 5.1 诊断阶段 (Diagnosis)

**触发条件**：`session.concepts.length === 0`

**行为**：
1. 计算诊断轮次（`diagnosisRound`）：根据已有 tutor 提问数 + 1
2. 第 1 轮：使用 `buildDiagnosisPrompt()` 的标准诊断提示
3. 后续轮次：追问诊断提示词
4. 当 `diagnosisRound >= 2` 且用户回答数 ≥ 提问数时，进入概念提取

### 5.2 概念提取阶段

**触发条件**：诊断完成且 concepts 仍为空

**行为**：
1. `stepExtractConcepts()`：调用 LLM，使用 `buildConceptExtractionPrompt()`
2. LLM 使用 `extract_concepts` 工具返回概念列表
3. 每个概念包含：`id`, `name`, `description`, `dependencies`
4. 生成 `ConceptState[]`，初始化状态为 `pending`
5. 生成路线图 HTML 文件
6. 发送"已识别关键概念"的转换消息

### 5.3 教学阶段 (Teaching)

**触发条件**：有未掌握概念（status 为 `pending` 或 `learning`）

**行为**：
1. 找到第一个未掌握概念，设置为 `currentConceptId`，状态改为 `learning`
2. `stepAskQuestion()`：根据当前概念构造问题
3. 同一概念提问 ≥ 3 轮后 → 进入掌握度检查

### 5.4 掌握度检查 (Mastery Check)

**触发条件**：当前概念已经 >= 3 轮对话

**行为**：
1. `stepMasteryCheck()`：LLM 从 4 个维度评估：
   - `correctness`（事实准确性）
   - `explanationDepth`（解释深度）
   - `novelApplication`（新颖应用）
   - `conceptDiscrimination`（概念区分）
2. 弹出 `SelfAssessment` 对话框，用户自评
3. `updateMasteryFromCheck()`：综合 LLM 评分和用户自评计算最终分
4. 分数 ≥ masteryThreshold（默认 80%）→ `mastered` + 练习任务
5. 分数 < 80% → `learning`，继续教学

### 5.5 练习任务 (Practice)

**触发条件**：概念刚被标记为 `mastered`

**行为**：
1. `stepPracticeTask()`：LLM 布置 2-5 分钟的练习任务
2. 选项：写变体、找错误、用自己的例子解释

### 5.6 间隔复习 (Review)

**触发条件**：恢复会话时检查是否有已掌握概念超过复习间隔

**行为**：
1. `stepReviewQuestion()`：LLM 出快速复习题
2. 回答正确则加倍复习间隔，错误则记录

### 5.7 阶段状态机图

```
                ┌─────────┐
                │ 诊断阶段  │
                └────┬────┘
                     │ 诊断完成
                     ▼
                ┌─────────┐
                │ 概念提取  │
                └────┬────┘
                     │ 概念就绪
                     ▼
    ┌──────────────────────────────────┐
    │  ┌────────────┐  轮次≥3  ┌──────┐│
    │  │ 教学阶段    ├────────►│掌握度 ││
    │  │ (提问回答)  │◄────────┤检查  ││
    │  └────────────┘  未通过  └──┬───┘│
    │                             │通过 │
    │                             ▼    │
    │                     ┌──────────┐ │
    │                     │ 练习任务  │ │
    │                     └────┬─────┘ │
    │                          │       │
    └──────────────────────────┘       │
        还有更多概念                    │
                                       │
        所有概念 mastered              │
              ▼                        │
         ┌────────┐                    │
         │ 结束    │◄──────────────────┘
         │ 总结输出 │
         └────────┘
```

---

## 6. 系统提示词构建

### 6.1 PromptBuilder (`PromptBuilder.ts`)

`PromptBuilder` 类负责构建所有发送给 LLM 的提示词。

#### 6.1.1 系统提示词结构

`buildSystemPrompt(ctx)` 生成完整系统提示词，格式如下：

```
你是一位苏格拉底式导师，使用 Bloom 的 2-Sigma 掌握学习法。
你的唯一角色是提出引导性问题，帮助学生自己发现答案。

## 核心规则（绝不能违反）
1. 绝不要直接给出答案
2. 先诊断
3. 掌握门控：4 维度需要 80%+ 分数
4. 每轮问 1-2 个问题
5. 要有耐心但要严格
6. 匹配用户的语言
7. ALL teaching must be based SOLELY on the provided note content
8. Skip social niceties — no "thank you", "congratulations"...

## 当前阶段
[根据 phase 动态填充]

## 学习进度
已掌握 3/10 个概念

## 会话摘要（早期内容）
[可选：早期对话摘要]

## 笔记内容
```
[笔记原文]
```

## 语言
Respond in Chinese (中文)

## 可用工具
[5 个工具的定义描述]

## 响应格式
根据你要做的事情使用适当的工具：
- 提问 → 调用 ask_question
- 提供指导/提示/反馈 → 调用 provide_guidance
- 评估掌握度 → 调用 assess_mastery
- 提取概念 → 调用 extract_concepts
- 发送信息性消息 → 调用 send_info

重要：当函数调用不可用时，请以 JSON 格式回复：
{ "tool": "...", "content": "...", ... }
```

#### 6.1.2 阶段描述映射

| 阶段 | 系统提示描述 |
|------|-------------|
| `diagnosis` | "你正在诊断学生对该主题的现有知识水平。评估他们的理解程度，不要开始教学。" |
| `teaching` | "你正在教授概念"{name}"。提出引导性问题，帮助学生发现答案。" |
| `mastery-check` | "你正在检查概念"{name}"的掌握程度。从4个维度进行评估。" |
| `practice` | "学生刚掌握了一个概念。布置一个小练习任务来巩固理解。" |
| `review` | "这是复习问题。问一个快速问题来检查已掌握概念的记忆保持。" |
| `finalize` | "会话即将结束。提供总结和后续建议。" |

#### 6.1.3 多阶段提示词

| 方法 | 用途 | 关键指令 |
|------|------|---------|
| `buildDiagnosisPrompt()` | 诊断阶段 | "问 1-2 个问题（选择题和开放题混合）来评估他们对这个主题的已有知识" |
| `buildConceptExtractionPrompt()` | 概念提取 | "分析笔记内容并提取 5-15 个原子概念/知识点" |
| `buildMasteryCheckPrompt(name)` | 掌握度检查 | "提问覆盖所有 4 个维度" |
| `buildConversationSummaryPrompt()` | 对话摘要 | "用中文总结以下对话的核心内容（不超过 4 句话）" |

---

### 6.2 运行时系统提示词装配流程

在每个教学步骤中，`SocraticEngine` 会按以下流程将系统提示词、对话历史和工具定义装配成完整的 LLM 请求。下面是完整的运行时装配序列：

```
SocraticEngine.stepXxx(session)
  │
  ├─ 步骤 1: getPhase(session)
  │   根据会话状态判断当前阶段
  │   ├─ session.concepts.length === 0            → "diagnosis"
  │   ├─ currentConcept?.status === 'mastered'     → "practice"
  │   ├─ 同一概念 tutor 提问 ≥ 3 轮               → "mastery-check"
  │   └─ 默认                                      → "teaching"
  │
  ├─ 步骤 2: buildContextAwareSystemPrompt(session)
  │   │
  │   ├─ 收集上下文:
  │   │   ├─ getPhase(session)                     → phase 字符串
  │   │   ├─ session.currentConceptId              → 当前教学的概念
  │   │   ├─ getConceptProgress(session)           → { mastered, total }
  │   │   ├─ conversationSummaries.get(slug)       → 早期对话摘要
  │   │   └─ session.noteContent                   → 笔记原文
  │   │
  │   └─ 传入 SystemPromptContext → PromptBuilder.buildSystemPrompt(ctx)
  │       ├─ [角色定义]     "你是一位苏格拉底式导师，使用 Bloom 的 2-Sigma..."
  │       ├─ [核心规则]     8 条不可违反的规则
  │       ├─ [阶段描述]     从 phaseDescriptions 映射表中选取
  │       ├─ [学习进度]     "已掌握 3/10 个概念"
  │       ├─ [会话摘要]     "早期对话的 LLM 生成的压缩摘要"（可选）
  │       ├─ [笔记内容]     ```...``` 包裹的完整笔记原文
  │       ├─ [语言]         "Respond in Chinese (中文)"
  │       ├─ [工具列表]     getToolDescriptions() 生成的 5 个工具文本描述
  │       └─ [响应格式]     优先工具调用 → 降级 JSON → 纯文本说明
  │
  ├─ 步骤 3: buildConversationContext(session)
  │   ├─ 消息数 > SUMMARY_THRESHOLD(12)?
  │   │   └─ 是 → 异步调用 LLM 压缩生成早期摘要（不阻塞当前请求）
  │   ├─ 取最近 MAX_CONTEXT_MESSAGES(15) 条消息
  │   ├─ 映射: tutor → assistant, user → user
  │   └─ 如有摘要 → 在消息列表最前面插入一条 [早期会话摘要]
  │
  ├─ 步骤 4: 拼接阶段专用 prompt 作为最后一条 user 消息
  │   ├─ diagnosis     → buildDiagnosisPrompt() 或追问提示
  │   ├─ teaching      → "你正在教学概念 {name}..."
  │   ├─ mastery-check → buildMasteryCheckPrompt(name)
  │   ├─ practice      → "学生已掌握 {name}，布置练习..."
  │   └─ review        → "概念 {name} 的快速复习问题..."
  │
  ├─ 步骤 5: LLMService.chat(systemPrompt, messages, TOOLS)
  │   │
  │   ├─ 构建 API 请求体:
  │   │   {
  │   │     "model": "gpt-4o",
  │   │     "messages": [
  │   │       ← 步骤 2 的 systemPrompt ── { "role": "system", "content": "你是一位苏格拉底式导师..." },
  │   │       ← 步骤 3 的 context ────── { "role": "assistant", "content": "[早期会话摘要]..." },
  │   │                                  { "role": "user", "content": "..." },
  │   │                                  { "role": "assistant", "content": "..." },
  │   │                                  ... 最近 15 条历史消息 ...
  │   │       ← 步骤 4 的 prompt ─────── { "role": "user", "content": "请先诊断学生的当前理解程度..." }
  │   │     ],
  │   │     "temperature": 0.7,
  │   │     "max_tokens": 2000,
  │   │     "tools": [ ← TOOLS 常量中的 5 个工具定义 ],
  │   │     "tool_choice": "auto"
  │   │   }
  │   │
  │   ├─ 添加 Authorization header（OpenAI 兼容端点）
  │   ├─ HTTP POST → LLM API
  │   └─ 返回 { "choices": [{ "message": { "content", "tool_calls" } }] }
  │
  ├─ 步骤 6: parseStructuredResponse(response)
  │   ├─ response.toolCalls?.length > 0?  → 优先: parseToolCall(toolCalls[0])
  │   ├─ response.content 含 { JSON }?    → 降级: JSON.parse(jsonMatch[0])
  │   └─ 纯文本?                          → 最终: send_info fallback
  │
  └─ 步骤 7: buildTutorMessageFromParsed(parsed) → TutorMessage
      ├─ inferMessageType(parsed) → "question" | "feedback" | "info"
      ├─ 构建 Question 对象（如为选择题: options, correctOptionIndex）
      └─ 返回 { id, role: "tutor", type, content, question, timestamp }
```

### 6.3 实际 API 请求示例

以下是 `stepDiagnosis` 阶段实际发送给 LLM 的请求结构：

```
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer sk-xxx...
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": "你是一位苏格拉底式导师，使用 Bloom 的 2-Sigma 掌握学习法。
你的唯一角色是提出引导性问题，帮助学生自己发现答案...

## 核心规则（绝不能违反）
1. 绝不要直接给出答案...
...

## 当前阶段
你正在诊断学生对该主题的现有知识水平。

## 学习进度
已掌握 0/0 个概念。

## 笔记内容
```
# Python 装饰器
装饰器是一种高阶函数...
```

## 语言
Respond in Chinese (中文)

## 可用工具
### ask_question
Ask the student a question...
### provide_guidance
...

## 响应格式
..."
    },
    {
      "role": "user",
      "content": "请先诊断学生的当前理解程度。问 1-2 个问题..."
    }
  ],
  "temperature": 0.7,
  "max_tokens": 2000,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "ask_question",
        "description": "Ask the student a question...",
        "parameters": { ... }
      }
    },
    // ... 共 5 个工具定义
  ],
  "tool_choice": "auto"
}
```

#### LLM 响应示例（含 tool_calls）

```json
{
  "choices": [{
    "message": {
      "content": null,
      "tool_calls": [
        {
          "id": "call_xxx",
          "type": "function",
          "function": {
            "name": "ask_question",
            "arguments": "{
              \"content\": \"Python 装饰器本质上是什么？\\n\\nA) 一种特殊的数据类型\\nB) 一个接受函数作为参数并返回新函数的高阶函数\\nC) 一个内置的关键字\\nD) 一个用于定义类的语法糖\",
              \"questionType\": \"multiple-choice\",
              \"options\": [
                \"一种特殊的数据类型\",
                \"一个接受函数作为参数并返回新函数的高阶函数\",
                \"一个内置的关键字\",
                \"一个用于定义类的语法糖\"
              ],
              \"correctOptionIndex\": 1,
              \"conceptId\": \"python-decorators\"
            }"
          }
        }
      ]
    },
    "finish_reason": "tool_calls"
  }]
}
```

### 6.4 系统提示词装配要点总结

| 方面 | 说明 |
|------|------|
| **动态装配** | 每次 LLM 调用都重新构建系统提示词，确保证阶段、进度、摘要信息始终最新 |
| **上下文管理** | 超过 12 条消息时自动异步压缩为摘要，只保留最近 15 条原始消息 |
| **工具调用降级** | API 不支持函数调用时，请求`不附加 tools`，系统提示词保留 JSON 格式要求作为备用 |
| **语言自适应** | 根据用户笔记语言自动设定教学语言（中文/英文） |
| **笔记绑定** | 所有教学内容必须基于笔记内容，系统提示词中通过第 7 条规则明确禁止引入外部知识 |
| **阶段透明** | LLM 知晓当前所处的教学阶段，并据此调整行为（诊断/教学/评估/练习） |

---

## 7. LLM 函数调用机制

### 7.1 工具定义 (`tools.ts`)

插件定义了 5 个 LLM 可调用的工具（OpenAI 函数调用格式）：

#### 7.1.1 `ask_question` — 提问

向学生提问，支持选择题和开放题。

```json
{
  "name": "ask_question",
  "description": "Ask the student a question...",
  "parameters": {
    "type": "object",
    "properties": {
      "content":           "问题文本",
      "questionType":      "multiple-choice | open-ended",
      "options":           "选择题选项数组（A/B/C/D）",
      "correctOptionIndex":"正确选项索引（0-based，内部追踪用）",
      "conceptId":         "关联概念 ID"
    },
    "required": ["content", "questionType"]
  }
}
```

#### 7.1.2 `provide_guidance` — 提供指导

给出苏格拉底式指导、提示或反馈，绝不给直接答案。

```json
{
  "name": "provide_guidance",
  "description": "Give Socratic guidance, hints, or feedback...",
  "parameters": {
    "properties": {
      "content":      "指导消息",
      "misconception": "检测到的误解描述",
      "rootCause":     "误解的推断根因",
      "conceptId":     "关联概念 ID"
    },
    "required": ["content"]
  }
}
```

#### 7.1.3 `assess_mastery` — 评估掌握度

从 4 个维度评估学生对概念的掌握程度。

```json
{
  "name": "assess_mastery",
  "description": "Assess the student's mastery of a concept across 4 dimensions...",
  "parameters": {
    "properties": {
      "content":               "评估总结",
      "correctness":           "boolean — 事实准确性",
      "explanationDepth":      "boolean — 解释深度",
      "novelApplication":      "boolean — 新颖应用",
      "conceptDiscrimination": "boolean — 概念区分",
      "conceptId":             "关联概念 ID"
    },
    "required": ["content", "correctness", "explanationDepth", "novelApplication", "conceptDiscrimination"]
  }
}
```

#### 7.1.4 `extract_concepts` — 提取概念

从笔记内容中提取学习概念。

```json
{
  "name": "extract_concepts",
  "description": "Extract learning concepts from the note content...",
  "parameters": {
    "properties": {
      "concepts": {
        "type": "array",
        "items": {
          "properties": {
            "id":           "唯一 slug ID",
            "name":         "概念名称",
            "description":  "简要描述",
            "dependencies": "前置概念 ID 数组"
          }
        }
      }
    },
    "required": ["concepts"]
  }
}
```

#### 7.1.5 `send_info` — 发送信息

发送信息性消息（进度更新、阶段转换等）。

```json
{
  "name": "send_info",
  "description": "Send an informational message...",
  "parameters": {
    "properties": {
      "content":   "信息消息",
      "conceptId": "关联概念 ID"
    },
    "required": ["content"]
  }
}
```

### 7.2 工具调用流程

#### 步骤 1：LLMService.chat() 发送请求 (`LLMService.ts:33`)

```typescript
async chat(systemPrompt, messages, temperature, maxTokens, tools) {
  const body = {
    model: this.settings.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens,
  };

  // 当 API 兼容 OpenAI 且启用了工具调用时附加 tools
  if (tools && this.supportsToolCalling()) {
    body['tools'] = tools;
    body['tool_choice'] = 'auto';
  }

  // 对 OpenAI 兼容端点添加 Authorization header
  if (this.isOpenAICompatible()) {
    headers['Authorization'] = `Bearer ${this.settings.apiKey}`;
  }

  // 通过 Obsidian 的 requestUrl 发送请求
  const response = await requestUrl({
    url: this.settings.apiEndpoint,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  // ...
}
```

#### 步骤 2：判断 API 是否支持工具调用 (`LLMService.ts:125`)

```typescript
private supportsToolCalling(): boolean {
  return !this.settings.disableToolCalling && this.isOpenAICompatible();
}

private isOpenAICompatible(): boolean {
  return (
    this.settings.apiEndpoint.includes('openai.com') ||
    this.settings.apiEndpoint.includes('api.aiproxy.io') ||
    !this.settings.apiEndpoint.includes('anthropic.com')
  );
}
```

**核心逻辑**：
- 如果 API 端点包含 `openai.com` 或 `api.aiproxy.io` → 支持函数调用
- 如果 API 端点包含 `anthropic.com` → **不支持**函数调用
- 否则（如本地 ollama 等）→ 视为 OpenAI 兼容，支持函数调用

#### 步骤 3：处理 API 响应

**有 tool_calls 的响应**（OpenAI 原生函数调用）：

```typescript
if (choice.message?.tool_calls) {
  return {
    content: choice.message.content || '',
    toolCalls: choice.message.tool_calls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    })),
    finishReason: 'tool_calls',
  };
}
```

**标准内容响应**：

```typescript
return {
  content: choice.message.content || '',
  finishReason: 'stop' 或 'length',
};
```

---

## 8. 响应解析与消息构建

### 8.1 parseStructuredResponse() (`SocraticEngine.ts:332`)

此方法将 LLM 的原始响应解析为结构化的 `LLMStructuredResponse`：

```typescript
parseStructuredResponse(response): LLMStructuredResponse {
  // 优先处理 tool_calls
  if (response.toolCalls?.length > 0) {
    return this.parseToolCall(response.toolCalls[0]);
  }

  // 降级：尝试从 content 中提取 JSON
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch { /* fall through */ }

  // 最终降级：纯文本 fallback
  return { tool: 'send_info', content: response.content, ... };
}
```

### 8.2 parseToolCall() — 工具调用解析器 (`SocraticEngine.ts:366`)

根据工具名称解析参数：

| 工具名 | 解析目标 | 关键提取字段 |
|--------|---------|-------------|
| `ask_question` | `MultipleChoiceArgs` | `content`, `questionType`, `options`, `correctOptionIndex`, `conceptId` |
| `provide_guidance` | `GuidanceArgs` | `content`, `misconception`, `rootCause`, `conceptId` |
| `assess_mastery` | `MasteryCheckArgs` | `content`, `correctness`, `explanationDepth`, `novelApplication`, `conceptDiscrimination`, `conceptId` |
| `extract_concepts` | `ConceptExtractionArgs` | `concepts[]` |
| `send_info` | `InfoArgs` | `content`, `conceptId` |

### 8.3 buildTutorMessageFromParsed() (`SocraticEngine.ts:441`)

将解析结果转换为 `TutorMessage`，这是 UI 显示的消息格式：

```typescript
buildTutorMessageFromParsed(parsed): TutorMessage {
  const question = parsed.questionType && parsed.options
    ? { id, conceptId, type: questionType, prompt, options }
    : undefined;

  return {
    id: generateId(),
    role: 'tutor',
    type: inferMessageType(parsed),  // 'question' | 'feedback' | 'info'
    content: parsed.content,
    question,
    timestamp: Date.now(),
  };
}
```

### 8.4 消息类型推断

| LLM 工具 | 消息类型 | 含义 |
|----------|---------|------|
| `ask_question` | `question` | 问题（含选择题选项） |
| `provide_guidance` | `feedback` | 指导/提示/反馈 |
| `assess_mastery` | `feedback` | 掌握度评估反馈 |
| `extract_concepts` | `info` | 概念提取信息 |
| `send_info` | `info` | 一般信息 |

### 8.5 降级机制

当 API **不支持**函数调用（如 Anthropic API 或纯文本模型）时，插件仍然可以工作：

1. 请求中**不附加** `tools` 参数
2. LLM 以纯文本回复（但系统提示中要求以 JSON 格式回复）
3. `parseStructuredResponse()` 尝试从文本中提取 `{...}` JSON
4. 如果 JSON 解析失败，将整个文本作为 `send_info` 类型的内容使用
5. 设置 `disableToolCalling: true` 可以手动强制关闭工具调用

---

## 9. 会话生命周期管理

### 9.1 SessionState 数据结构 (`types.ts:60`)

```typescript
interface SessionState {
  noteTitle: string;         // 笔记标题
  noteSlug: string;          // URL 友好的标识符
  noteContent: string;       // 笔记完整内容
  createdAt: number;         // 创建时间戳
  updatedAt: number;         // 更新时间戳
  currentConceptId: string | null;  // 当前正在教学的概念 ID
  concepts: ConceptState[];  // 所有概念状态
  conceptOrder: string[];    // 概念学习顺序
  misconceptions: MisconceptionRecord[]; // 检测到的误解记录
  messages: TutorMessage[];  // 完整对话消息
  completed: boolean;        // 是否已完成
}
```

### 9.2 持久化存储

`SessionManager` 负责保存/加载会话到 Obsidian Vault：

```
.vault/
  .socratic-sessions/
    {note-slug}/
      session.json       ← SessionState（完整会话数据）
      roadmap.html       ← 学习路线图
      summary.html       ← 进度摘要
      final-summary.html ← 最终总结
```

**保存时机**：每次 LLM 响应处理后立即保存（`sessionManager.saveSession()`）

**恢复流程** (`resumeSession()`):
1. 重新显示所有历史消息
2. 检查已掌握概念是否需要间隔复习
3. 检查最后一条消息是否还有待回答的问题
4. 如果没有待处理的问题，继续教学

### 9.3 上下文管理

`SocraticEngine` 实现了智能上下文截断：

- **最近消息**：保留最近的 `MAX_CONTEXT_MESSAGES`（15 条）
- **对话摘要**：`SUMMARY_THRESHOLD`（12 条）消息后自动生成早期对话摘要
- **摘要生成**：使用 LLM 自身生成"早期会话摘要"并注入到系统提示中

---

## 10. 数据流与状态同步

### 10.1 用户操作 → Plugin 调用路径

```
用户输入文本 / 点击选项
        │
        ▼
Composer.tsx / OptionsBar.tsx
        │ 调用 context 回调
        ▼
SocraticContext.tsx
  onSendMessage / onSelectOption
        │ 设置 isProcessing=true
        ▼
main.ts
  processUserResponse(text) / processChoiceSelection(option, index)
        │ 添加 user 消息到 session
        ▼
  continueTutoring()
        │ 调用 engine 方法
        ▼
SocraticEngine.ts
  stepAskQuestion() / stepMasteryCheck() 等
        │ 调用 LLM
        ▼
LLMService.chat()
        │ HTTP POST
        ▼
LLM API → 返回 tool_calls / content
        │
        ▼ 回传路径
SocraticEngine.parseStructuredResponse()
  → buildTutorMessageFromParsed()
  → 返回 TutorMessage
        │
        ▼
main.ts 接收消息
  → 添加到 session.messages
  → view.addMessage(msg)  // 更新 ViewState
  → sessionManager.saveSession()  // 持久化
        │
        ▼
React 重新渲染（useSyncExternalStore 检测到状态变化）
  → 新消息显示到 Thread
  → TypingIndicator 消失
```

### 10.2 对话框 Promise 模式

`SelfAssessment` 和 `SessionResume` 使用 Promise 桥接模式：

```typescript
// ReactSocraticView 暴露 Promise 给 Plugin
showSelfAssessment(): Promise<SelfAssessmentLevel> {
  return new Promise(resolve => {
    this.updateState({ selfAssessment: { resolve } });
  });
}

// React 通过 resolve 回调完成 Promise
resolveSelfAssessment(level) {
  this._state.selfAssessment?.resolve(level);
  this.updateState({ selfAssessment: null });
}

// Plugin 等待 Promise 完成
async runMasteryCheck(conceptId) {
  const selfAssessment = await view.showSelfAssessment();
  // 继续执行...
}
```

---

## 11. 文件结构一览

```
src/
├── main.ts                         ← 插件入口，协调所有模块
├── types.ts                        ← 核心类型定义
├── settings.ts                     ← 设置标签页
│
├── engine/
│   └── SocraticEngine.ts           ← 教学引擎（阶段控制、响应解析）
│
├── llm/
│   ├── LLMService.ts               ← LLM API 通信层
│   ├── PromptBuilder.ts            ← 系统提示词构建器
│   └── tools.ts                    ← 工具/函数定义
│
├── ui/
│   ├── ReactSocraticView.ts        ← Obsidian ItemView + React 桥接
│   │
│   └── react/
│       ├── SocraticApp.tsx          ← React 根组件
│       ├── SocraticContext.tsx      ← React Context + 状态订阅
│       │
│       └── components/
│           ├── Thread.tsx           ← 消息列表 + 输入框容器
│           ├── MessageBubble.tsx    ← 单条消息气泡
│           ├── OptionsBar.tsx       ← 选择题选项按钮
│           ├── Composer.tsx         ← 文本输入框
│           ├── TypingIndicator.tsx  ← "思考中"动画
│           ├── ProgressPanel.tsx    ← 学习进度面板
│           ├── WelcomeScreen.tsx    ← 欢迎界面
│           ├── SelfAssessment.tsx   ← 自评对话框
│           └── SessionResume.tsx    ← 恢复会话对话框
│
├── session/
│   └── SessionManager.ts           ← 会话持久化管理
│
├── i18n/
│   └── translations.ts             ← 中英文翻译
│
└── utils/
    └── helpers.ts                  ← 工具函数
```

---

## 附录：关键数据流图

```
                      ┌─────────────────────────────────────┐
                      │      Obsidian 插件初始化              │
                      │  onload()                            │
                      │    ├─ loadSettings()                 │
                      │    ├─ new SessionManager()           │
                      │    ├─ new LLMService(settings)       │
                      │    ├─ new SocraticEngine(llmService) │
                      │    ├─ registerView()                 │
                      │    ├─ addRibbonIcon()                │
                      │    └─ activateView()                 │
                      └──────────┬──────────────────────────┘
                                 │
                                 ▼
                      ┌─────────────────────────────────────┐
                      │  ReactSocraticView.onOpen()          │
                      │  → mount React (SocraticApp)         │
                      │  → 显示 WelcomeScreen                │
                      └──────────┬──────────────────────────┘
                                 │ 用户点击"开始辅导"
                                 ▼
                      ┌─────────────────────────────────────┐
                      │  main.ts.startTutoring()             │
                      │    ├─ 获取当前笔记内容                │
                      │    ├─ 检测笔记语言                    │
                      │    ├─ 检查已有会话 → 恢复/重新开始    │
                      │    └─ startNewSessionWithNote()      │
                      └──────────┬──────────────────────────┘
                                 │
                                 ▼
               ╔══════════════════════════════════════════╗
               ║      SocraticEngine 教学循环             ║
               ║                                          ║
               ║  continueTutoring() 每次用户回应后触发    ║
               ║                                          ║
               ║  ┌─ 阶段判断 ──────────────────────────┐ ║
               ║  │                                     │ ║
               ║  │  concepts.length === 0?             │ ║
               ║  │   ├─ YES → stepDiagnosis()          │ ║
               ║  │   │        ├─ round 1: 标准诊断      │ ║
               ║  │   │        └─ round N: 追问诊断      │ ║
               ║  │   │        round≥2 && 已回答≥提问数  │ ║
               ║  │   │        → stepExtractConcepts()   │ ║
               ║  │   │                                  │ ║
               ║  │   └─ NO → 检查 currentConcept        │ ║
               ║  │          ├─ mastered+近期评估→practice│ ║
               ║  │          ├─ 提问≥3轮→mastery-check   │ ║
               ║  │          └─ 默认→teaching             │ ║
               ║  └──────────────────────────────────────┘ ║
               ║                    │                       ║
               ║                    ▼                       ║
               ║  ┌─ 步骤方法调用 ───────────────────────┐ ║
               ║  │  stepDiagnosis / stepAskQuestion /   │ ║
               ║  │  stepMasteryCheck / stepPracticeTask  │ ║
               ║  │                                      │ ║
               ║  │  每个步骤都执行相同的 7 步装配流程:   │ ║
               ║  │                                      │ ║
               ║  │  ┌──────────────────────────────┐    │ ║
               ║  │  │ 第1步: getPhase(session)     │    │ ║
               ║  │  │       → 确定阶段             │    │ ║
               ║  │  └──────────┬───────────────────┘    │ ║
               ║  │             ▼                        │ ║
               ║  │  ┌──────────────────────────────┐    │ ║
               ║  │  │ 第2步: buildContextAware      │    │ ║
               ║  │  │        SystemPrompt(session)  │    │ ║
               ║  │  │  ┌─ 收集:                    │    │ ║
               ║  │  │  │ phase, currentConcept,     │    │ ║
               ║  │  │  │ progress, summary, content │    │ ║
               ║  │  │  └─ → PromptBuilder          │    │ ║
               ║  │  │     .buildSystemPrompt(ctx)   │    │ ║
               ║  │  │     = 完整 system prompt      │    │ ║
               ║  │  └──────────┬───────────────────┘    │ ║
               ║  │             ▼                        │ ║
               ║  │  ┌──────────────────────────────┐    │ ║
               ║  │  │ 第3步: buildConversation      │    │ ║
               ║  │  │        Context(session)       │    │ ║
               ║  │  │  → 最近 15 条消息 + 摘要     │    │ ║
               ║  │  └──────────┬───────────────────┘    │ ║
               ║  │             ▼                        │ ║
               ║  │  ┌──────────────────────────────┐    │ ║
               ║  │  │ 第4步: 拼接阶段专用 prompt   │    │ ║
               ║  │  │ 作为最后一条 user 消息        │    │ ║
               ║  │  └──────────┬───────────────────┘    │ ║
               ║  │             ▼                        │ ║
               ║  │  ┌──────────────────────────────┐    │ ║
               ║  │  │ 第5步: LLMService.chat(      │    │ ║
               ║  │  │   systemPrompt,              │    │ ║
               ║  │  │   messages + prompt,          │    │ ║
               ║  │  │   temp, maxTokens,           │    │ ║
               ║  │  │   TOOLS                      │    │ ║
               ║  │  │ )                            │    │ ║
               ║  │  │                              │    │ ║
               ║  │  │  API Request:                │    │ ║
               ║  │  │  ┌─────────────────────┐    │    │ ║
               ║  │  │  │ system: systemPrompt │    │    │ ║
               ║  │  │  │ user:   ...         │    │    │ ║
               ║  │  │  │ asst:   ...         │    │    │ ║
               ║  │  │  │ user:   stagePrompt │    │    │ ║
               ║  │  │  ├─────────────────────┤    │    │ ║
               ║  │  │  │ tools: TOOLS (5个)  │    │    │ ║
               ║  │  │  │ tool_choice: auto   │    │    │ ║
               ║  │  │  └─────────────────────┘    │    │ ║
               ║  │  │                              │    │ ║
               ║  │  │  → HTTP POST → LLM API       │    │ ║
               ║  │  │  ← tool_calls / content      │    │ ║
               ║  │  └──────────┬───────────────────┘    │ ║
               ║  │             ▼                        │ ║
               ║  │  ┌──────────────────────────────┐    │ ║
               ║  │  │ 第6步: parseStructured        │    │ ║
               ║  │  │        Response(response)     │    │ ║
               ║  │  │  ┌─ tool_calls?              │    │ ║
               ║  │  │  │  → parseToolCall()        │    │ ║
               ║  │  │  ├─ JSON in content?         │    │ ║
               ║  │  │  │  → JSON.parse()           │    │ ║
               ║  │  │  └─ 纯文本?                  │    │ ║
               ║  │  │     → send_info fallback     │    │ ║
               ║  │  └──────────┬───────────────────┘    │ ║
               ║  │             ▼                        │ ║
               ║  │  ┌──────────────────────────────┐    │ ║
               ║  │  │ 第7步: buildTutorMessage     │    │ ║
               ║  │  │        FromParsed(parsed)    │    │ ║
               ║  │  │  → inferMessageType()        │    │ ║
               ║  │  │  → 构建 Question（如选择题） │    │ ║
               ║  │  │  → TutorMessage              │    │ ║
               ║  │  └──────────┬───────────────────┘    │ ║
               ║  └─────────────┼────────────────────────┘ ║
               ║                │                           ║
               ║        返回 TutorMessage                   ║
               ╚══════════════════════════════════════════════╝
                                 │
                                 ▼
                      ┌─────────────────────────────────────┐
                      │  main.ts 回传处理                    │
                      │                                     │
                      │  1. session.messages.push(msg)      │
                      │  2. view.updateState({ messages })  │
                      │     → React 重新渲染                │
                      │  3. sessionManager.saveSession()    │
                      │     → 持久化到磁盘                   │
                      │  4. 继续教学循环                     │
                      │     → continueTutoring()            │
                      └─────────────────────────────────────┘
                                 │
                                 ▼
               ╔══════════════════════════════════════════╗
               ║      React 界面层                        ║
               ║                                          ║
               ║  useSyncExternalStore(view)               ║
               ║       → 检测状态变化                      ║
               ║       → 触发重新渲染                      ║
               ║                                          ║
               ║  ┌──────────────────────────────────┐    ║
               ║  │  MessageBubble                   │    ║
               ║  │  ├─ role: tutor → 左侧气泡       │    ║
               ║  │  ├─ role: user  → 右侧气泡       │    ║
               ║  │  ├─ type: question → 含选项按钮  │    ║
               ║  │  ├─ type: feedback → 样式强调     │    ║
               ║  │  └─ type: info    → 灰色信息      │    ║
               ║  └──────────────────────────────────┘    ║
               ║  TypingIndicator → 处理中动画            ║
               ║  ProgressPanel  → 概念掌握进度           ║
               ║  Composer       → 用户输入框             ║
               ║                                          ║
               ╚══════════════════════════════════════════╝
                                 │
                   用户输入 / 点击选择题选项
                                 │
                                 ▼
                      ┌─────────────────────────────────────┐
                      │  processUserResponse(text)          │
                      │  processChoiceSelection(opt, idx)   │
                      │                                     │
                      │  1. 添加 user 消息到 session        │
                      │  2. view.updateState() → 渲染用户消息│
                      │  3. continueTutoring()              │
                      │     → 回到教学循环（重新装配提示词） │
                      └─────────────────────────────────────┘
```

---

> **文档版本**: v1.0  
> **最后更新**: 2026-04-25  
> **适用项目**: Socratic Note Tutor (Obsidian 插件)
