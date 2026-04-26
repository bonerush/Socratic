export type Lang = 'en' | 'zh';

export interface TranslationMap {
  viewTitle: string;
  viewStatusReady: string;
  noActiveSession: string;
  startTutoring: string;
  viewRoadmap: string;
  newSession: string;
  inputPlaceholder: string;
  welcomeMessage: string;
  thinking: string;
  selfAssessmentTitle: string;
  selfAssessmentSolid: string;
  selfAssessmentOkay: string;
  selfAssessmentFuzzy: string;
  selfAssessmentLost: string;
  resumeDialogTitle: string;
  resumeResume: string;
  resumeRestart: string;
  sessionCleared: string;
  sessionHistoryTitle: string;
  sessionHistoryEmpty: string;
  continueLabel: string;
  deleteLabel: string;
  conceptsLabel: string;
  messagesLabel: string;
  completedLabel: string;
  inProgressLabel: string;
  loading: string;
  sessionNotFound: string;
  closeLabel: string;
  noPanel: string;
  noApiKey: string;
  noNote: string;
  emptyNote: string;
  noRoadmap: string;
  dueForReview: string;
  masteryCheckFailed: string;
  practiceFailed: string;
  reviewFailed: string;
  finalizeFailed: string;
  outputFailed: string;
  profileFailed: string;
  startFailed: string;
  resumeFailed: string;
  diagnosisFailed: string;
  conceptExtractFailed: string;
  tutoringError: string;
  emptyInput: string;
  conceptTransition: string;
  // Processing phases shown in TypingIndicator
  phaseDiagnosis: string;
  phaseExtractConcepts: string;
  phaseAskQuestion: string;
  phaseMasteryCheck: string;
  phasePracticeTask: string;
  phaseReview: string;
  phaseFinalize: string;
  // Settings
  settingsTitle: string;
  apiEndpointLabel: string;
  apiEndpointDesc: string;
  apiKeyLabel: string;
  apiKeyDesc: string;
  modelLabel: string;
  modelDesc: string;
  langLabel: string;
  langDesc: string;
  langAuto: string;
  langEn: string;
  langZh: string;
  storagePathLabel: string;
  storagePathDesc: string;
  masteryLabel: string;
  masteryDesc: string;
  maxConceptsLabel: string;
  maxConceptsDesc: string;
}

const en: TranslationMap = {
  viewTitle: 'Socratic Tutor',
  viewStatusReady: 'Ready',
  noActiveSession: 'No active session',
  startTutoring: 'Start Tutoring',
  viewRoadmap: 'View Roadmap',
  newSession: 'New Session',
  inputPlaceholder: 'Type your answer here...',
  welcomeMessage: 'Open a note and click "Start Tutoring" to begin.',
  thinking: 'Thinking',
  selfAssessmentTitle: 'How well do you feel you understand this concept?',
  selfAssessmentSolid: 'Solid — I could teach it',
  selfAssessmentOkay: 'Okay — I mostly get it',
  selfAssessmentFuzzy: 'Fuzzy — Some gaps remain',
  selfAssessmentLost: 'Lost — I don\'t understand',
  resumeDialogTitle: 'An unfinished session was found. Would you like to resume or start fresh?',
  resumeResume: 'Resume last session',
  resumeRestart: 'Start fresh',
  sessionCleared: 'Session cleared. Open a note and click "Start Tutoring".',
  sessionHistoryTitle: 'Session History',
  sessionHistoryEmpty: 'No sessions found.',
  continueLabel: 'Continue',
  deleteLabel: 'Delete',
  conceptsLabel: 'concepts',
  messagesLabel: 'messages',
  completedLabel: 'completed',
  inProgressLabel: 'in progress',
  loading: 'Loading',
  sessionNotFound: 'Session not found.',
  closeLabel: 'Close',
  noPanel: 'Please open the Socratic Tutor panel first.',
  noApiKey: 'Please configure your API key in plugin settings first.',
  noNote: 'Please open a note to start tutoring.',
  emptyNote: 'The current note is empty. Please write some content first.',
  noRoadmap: 'Roadmap not yet generated. Start a tutoring session first.',
  dueForReview: 'concept(s) due for review. Let\'s do a quick check first.',
  masteryCheckFailed: 'Mastery check failed',
  practiceFailed: 'Practice task failed',
  reviewFailed: 'Review failed',
  finalizeFailed: 'Failed to finalize session',
  outputFailed: 'Failed to generate session outputs',
  profileFailed: 'Failed to update learner profile',
  startFailed: 'Failed to start tutoring',
  resumeFailed: 'Failed to resume session',
  diagnosisFailed: 'Diagnosis failed',
  conceptExtractFailed: 'Failed to analyze concepts',
  tutoringError: 'Error',
  emptyInput: 'Please enter your answer.',
  conceptTransition: 'Identified key concepts. Beginning guided learning.',
  phaseDiagnosis: 'Diagnosing',
  phaseExtractConcepts: 'Building concept map',
  phaseAskQuestion: 'Crafting question',
  phaseMasteryCheck: 'Checking mastery',
  phasePracticeTask: 'Designing practice',
  phaseReview: 'Preparing review',
  phaseFinalize: 'Wrapping up',
  settingsTitle: 'Socratic Note Tutor Settings',
  apiEndpointLabel: 'API endpoint',
  apiEndpointDesc: 'The API endpoint for the LLM service (e.g. OpenAI, Anthropic, or local LLM).',
  apiKeyLabel: 'API key',
  apiKeyDesc: 'Your API key for the LLM service.',
  modelLabel: 'Model',
  modelDesc: 'The model to use for tutoring.',
  langLabel: 'Language preference',
  langDesc: "Tutoring language. 'Auto' follows the note content language.",
  langAuto: 'Auto',
  langEn: 'English',
  langZh: '中文',
  storagePathLabel: 'Session storage path',
  storagePathDesc: 'Custom path for storing session data. Leave empty to use vault root.',
  masteryLabel: 'Mastery threshold',
  masteryDesc: 'Minimum score (0-100) required to mark a concept as mastered.',
  maxConceptsLabel: 'Max concepts per session',
  maxConceptsDesc: 'Maximum number of concepts to extract from a single note.',
};

const zh: TranslationMap = {
  viewTitle: '苏格拉底笔记导师',
  viewStatusReady: '就绪',
  noActiveSession: '无活跃会话',
  startTutoring: '开始辅导',
  viewRoadmap: '查看学习路线',
  newSession: '新建会话',
  inputPlaceholder: '在此输入你的答案...',
  welcomeMessage: '打开笔记并点击"开始辅导"以开始学习。',
  thinking: '思考中',
  selfAssessmentTitle: '你觉得自己对这个概念的掌握程度如何？',
  selfAssessmentSolid: '扎实——我可以教给别人',
  selfAssessmentOkay: '还好——我基本理解了',
  selfAssessmentFuzzy: '模糊——还有一些盲点',
  selfAssessmentLost: '不懂——我没有理解',
  resumeDialogTitle: '发现未完成的会话。是否继续上次的进度还是重新开始？',
  resumeResume: '继续上次会话',
  resumeRestart: '重新开始',
  sessionCleared: '已清除会话。打开笔记并点击"开始辅导"。',
  sessionHistoryTitle: '会话历史',
  sessionHistoryEmpty: '没有找到会话记录。',
  continueLabel: '继续',
  deleteLabel: '删除',
  conceptsLabel: '个概念',
  messagesLabel: '条消息',
  completedLabel: '已完成',
  inProgressLabel: '进行中',
  loading: '加载中',
  sessionNotFound: '会话未找到。',
  closeLabel: '关闭',
  noPanel: '请先打开苏格拉底导师面板。',
  noApiKey: '请先在插件设置中配置 API 密钥。',
  noNote: '请打开一篇笔记以开始辅导。',
  emptyNote: '当前笔记为空，请先写入一些内容。',
  noRoadmap: '学习路线尚未生成，请先开始一个辅导会话。',
  dueForReview: '个概念需要复习。让我们先快速检查一下。',
  masteryCheckFailed: '掌握程度检查失败',
  practiceFailed: '练习任务失败',
  reviewFailed: '复习失败',
  finalizeFailed: '未能完成会话',
  outputFailed: '生成会话输出失败',
  profileFailed: '更新学习者档案失败',
  startFailed: '开始辅导失败',
  resumeFailed: '恢复会话失败',
  diagnosisFailed: '诊断失败',
  conceptExtractFailed: '分析概念失败',
  tutoringError: '出错',
  emptyInput: '请输入你的回答。',
  conceptTransition: '已识别关键概念，开始引导式学习。',
  phaseDiagnosis: '诊断中',
  phaseExtractConcepts: '构建概念图谱中',
  phaseAskQuestion: '生成问题中',
  phaseMasteryCheck: '评估掌握度中',
  phasePracticeTask: '设计练习任务中',
  phaseReview: '生成复习问题中',
  phaseFinalize: '生成总结中',
  settingsTitle: '苏格拉底笔记导师 - 设置',
  apiEndpointLabel: 'API 接口地址',
  apiEndpointDesc: 'LLM 服务的 API 接口地址（如 OpenAI、Anthropic 或本地 LLM）。',
  apiKeyLabel: 'API 密钥',
  apiKeyDesc: '你的 LLM 服务 API 密钥。',
  modelLabel: '模型',
  modelDesc: '用于辅导的模型。',
  langLabel: '语言偏好',
  langDesc: '辅导语言。"自动"会根据笔记内容语言自动选择。',
  langAuto: '自动',
  langEn: '英语',
  langZh: '中文',
  storagePathLabel: '会话存储路径',
  storagePathDesc: '存储会话数据的自定义路径。留空则使用仓库根目录。',
  masteryLabel: '掌握阈值',
  masteryDesc: '将概念标记为已掌握所需的最低分数（0-100）。',
  maxConceptsLabel: '每会话最大概念数',
  maxConceptsDesc: '从单篇笔记中提取的最大概念数量。',
};

const allTranslations: Record<Lang, TranslationMap> = { en, zh };

export function getTranslations(lang: Lang): TranslationMap {
  return allTranslations[lang] || en;
}

export function resolveLang(setting: string, noteContent: string): Lang {
  if (setting === 'zh') return 'zh';
  if (setting === 'en') return 'en';
  // auto: detect from note content
  const zhCharCount = (noteContent.match(/[\u4e00-\u9fff]/g) || []).length;
  return zhCharCount > 10 ? 'zh' : 'en';
}
