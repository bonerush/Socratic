export const PLUGIN_ID = 'socratic-note-tutor';
const PLUGIN_NAME = 'Socratic Note Tutor';
export const VIEW_TYPE_SOCRATIC = `${PLUGIN_ID}:socratic-view`;
export const SESSION_DIR = '.socratic-sessions';

export type ConceptStatus = 'pending' | 'learning' | 'mastered' | 'skipped';

export interface ConceptState {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  status: ConceptStatus;
  masteryScore: number;
  lastReviewTime: number | null;
  reviewInterval: number;
  selfAssessment: SelfAssessmentLevel | null;
}

export type SelfAssessmentLevel = 'solid' | 'okay' | 'fuzzy' | 'lost';

export interface MasteryDimension {
  correctness: boolean;
  explanationDepth: boolean;
  novelApplication: boolean;
  conceptDiscrimination: boolean;
}

export interface MisconceptionRecord {
  id: string;
  conceptId: string;
  misconception: string;
  inferredRootCause: string;
  resolved: boolean;
  resolvedDate: number | null;
  userExplanation: string | null;
}

export type QuestionType = 'multiple-choice' | 'open-ended';

export interface Question {
  id: string;
  conceptId: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  correctOptionIndex?: number;
  isReviewQuestion?: boolean;
}

export interface TutorMessage {
  id: string;
  role: 'tutor' | 'user';
  type: 'question' | 'answer' | 'feedback' | 'info' | 'choice-result' | 'system';
  content: string;
  question?: Question;
  timestamp: number;
}

export interface SessionState {
  noteTitle: string;
  noteSlug: string;
  noteContent: string;
  createdAt: number;
  updatedAt: number;
  currentConceptId: string | null;
  concepts: ConceptState[];
  conceptOrder: string[];
  misconceptions: MisconceptionRecord[];
  messages: TutorMessage[];
  completed: boolean;
}

export interface LearnerProfile {
  learningStyle: string;
  commonMisconceptionPatterns: string[];
  selfCalibrationHistory: { actual: number; selfAssessed: SelfAssessmentLevel; timestamp: number }[];
  sessionCount: number;
  lastUpdated: number;

  /** Extracted memories from past sessions. */
  memories: MemoryCollection;
  /** Concepts the student has shown strength in. */
  preferredConcepts: string[];
  /** Concepts the student has struggled with. */
  strugglingConcepts: string[];
}

// ── Memory System ───────────────────────────────────────────

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface Memory {
  id: string;
  type: MemoryType;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface MemoryCollection {
  user: Memory[];
  feedback: Memory[];
  project: Memory[];
  reference: Memory[];
}

export function emptyMemoryCollection(): MemoryCollection {
  return { user: [], feedback: [], project: [], reference: [] };
}

export interface SocraticPluginSettings {
  apiEndpoint: string;
  apiKey: string;
  model: string;
  language: string;
  sessionStoragePath: string;
  maxConceptsPerSession: number;
  masteryThreshold: number;
  reviewIntervalBase: number;
  reviewIntervalMax: number;
  disableToolCalling: boolean;
  /** Path to memory files (defaults to sessionStoragePath/.memories). */
  memoryStoragePath: string;
}

export const DEFAULT_SETTINGS: SocraticPluginSettings = {
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4',
  language: 'zh',
  sessionStoragePath: '',
  maxConceptsPerSession: 15,
  masteryThreshold: 80,
  reviewIntervalBase: 86400,
  reviewIntervalMax: 2764800,
  disableToolCalling: false,
  memoryStoragePath: '',
};
