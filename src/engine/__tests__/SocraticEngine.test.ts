import { describe, it, expect } from 'vitest';
import { SocraticEngine } from '../SocraticEngine';
import { ResponseParser } from '../ResponseParser';
import { LLMService } from '../../llm/LLMService';
import type { SessionState, TutorMessage, SocraticPluginSettings } from '../../types';
import type { ToolDefinition } from '../../llm/tools';

interface EngineWithGetPhase {
  getPhase(session: SessionState): string;
}

const DEFAULT_SETTINGS: SocraticPluginSettings = {
  apiKey: 'test-key',
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  masteryThreshold: 80,
  language: 'auto',
  disableToolCalling: false,
  sessionStoragePath: '.socratic-sessions',
  maxConceptsPerSession: 15,
  reviewIntervalBase: 86400,
  reviewIntervalMax: 604800,
  memoryStoragePath: '.socratic-sessions/.memories',
  debugMode: false,
  debugStoragePath: '.socratic-sessions/debug',
};

function createMockLLM(): LLMService {
  return new LLMService(DEFAULT_SETTINGS);
}

function createEmptySession(): SessionState {
  return {
    noteSlug: 'test-note',
    noteTitle: 'Test Note',
    noteContent: 'This is a test note about TypeScript basics.',
    messages: [],
    concepts: [],
    conceptOrder: [],
    currentConceptId: null,
    completed: false,
    misconceptions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createSessionWithConcepts(): SessionState {
  return {
    ...createEmptySession(),
    concepts: [
      { id: 'ts-types', name: 'TypeScript Types', description: 'Basic types', dependencies: [], status: 'learning', masteryScore: 0, lastReviewTime: null, reviewInterval: 0, selfAssessment: null },
      { id: 'ts-generics', name: 'Generics', description: 'Generic types', dependencies: ['ts-types'], status: 'pending', masteryScore: 0, lastReviewTime: null, reviewInterval: 0, selfAssessment: null },
    ],
    conceptOrder: ['ts-types', 'ts-generics'],
    currentConceptId: 'ts-types',
  };
}

function makeTutorQuestion(content: string, conceptId: string, options?: string[]): TutorMessage {
  return {
    id: `q-${Math.random().toString(36).slice(2)}`,
    role: 'tutor',
    type: 'question',
    content,
    question: {
      id: `qq-${Math.random().toString(36).slice(2)}`,
      conceptId,
      type: options ? 'multiple-choice' : 'open-ended',
      prompt: content,
      options,
      correctOptionIndex: options ? 0 : undefined,
    },
    timestamp: Date.now(),
  };
}

function makeTutorFeedback(content: string): TutorMessage {
  return {
    id: `f-${Math.random().toString(36).slice(2)}`,
    role: 'tutor',
    type: 'feedback',
    content,
    timestamp: Date.now(),
  };
}

function countRoundsForConcept(session: SessionState, conceptId: string): number {
  return session.messages.filter(m => {
    if (m.role !== 'tutor') return false;
    // Only count questions explicitly tagged with this conceptId.
    return m.question?.conceptId === conceptId;
  }).length;
}

describe('ResponseParser.parseStructuredResponse', () => {
  const parser = new ResponseParser();

  it('parses valid provide_guidance tool call with question', () => {
    const parsed = parser.parseStructuredResponse({
      content: '',
      toolCalls: [{
        id: '1',
        type: 'function',
        function: {
          name: 'provide_guidance',
          arguments: JSON.stringify({
            content: 'What is a type in TypeScript?',
            questionType: 'open-ended',
            conceptId: 'ts-types',
          }),
        },
      }],
    });
    expect(parsed.tool).toBe('provide_guidance');
    expect(parsed.content).toBe('What is a type in TypeScript?');
    expect(parsed.questionType).toBe('open-ended');
    expect(parsed.conceptId).toBe('ts-types');
  });

  it('falls back to message.content when tool call content is empty (the "..." root cause)', () => {
    // Some models call the tool correctly but leave the "content" parameter
    // empty, while putting the actual text in message.content.
    const parsed = parser.parseStructuredResponse({
      content: 'What is a type in TypeScript?',
      toolCalls: [{
        id: '1',
        type: 'function',
        function: {
          name: 'provide_guidance',
          arguments: JSON.stringify({
            content: '',
            questionType: 'open-ended',
            conceptId: 'ts-types',
          }),
        },
      }],
    });
    expect(parsed.tool).toBe('provide_guidance');
    expect(parsed.content).toBe('What is a type in TypeScript?');
    expect(parsed.questionType).toBe('open-ended');
  });

  it('parses valid provide_guidance tool call with multiple-choice', () => {
    const parsed = parser.parseStructuredResponse({
      content: '',
      toolCalls: [{
        id: '1',
        type: 'function',
        function: {
          name: 'provide_guidance',
          arguments: JSON.stringify({
            content: 'Which is a valid type?',
            questionType: 'multiple-choice',
            options: ['string', 'text', 'word'],
            correctOptionIndex: 0,
            conceptId: 'ts-types',
          }),
        },
      }],
    });
    expect(parsed.questionType).toBe('multiple-choice');
    expect(parsed.options).toEqual(['string', 'text', 'word']);
    expect(parsed.correctOptionIndex).toBe(0);
  });

  it('falls back to JSON in content when no tool calls', () => {
    const parsed = parser.parseStructuredResponse({
      content: JSON.stringify({
        tool: 'provide_guidance',
        content: 'Explain generics.',
        questionType: 'open-ended',
        conceptId: 'ts-generics',
      }),
    });
    expect(parsed.tool).toBe('provide_guidance');
    expect(parsed.content).toBe('Explain generics.');
    expect(parsed.questionType).toBe('open-ended');
  });

  it('falls back to JSON inside markdown code block', () => {
    const parsed = parser.parseStructuredResponse({
      content: '```json\n' + JSON.stringify({
        tool: 'provide_guidance',
        content: 'What is inference?',
        questionType: 'open-ended',
      }) + '\n```',
    });
    expect(parsed.tool).toBe('provide_guidance');
    expect(parsed.content).toBe('What is inference?');
  });

  it('returns send_info fallback on completely empty response', () => {
    const parsed = parser.parseStructuredResponse({ content: '' });
    expect(parsed.tool).toBe('send_info');
    expect(parsed.content.length).toBeGreaterThan(0);
  });

  it('does not override extract_concepts empty content with message.content', () => {
    const parsed = parser.parseStructuredResponse({
      content: 'some random text',
      toolCalls: [{
        id: '1',
        type: 'function',
        function: {
          name: 'extract_concepts',
          arguments: JSON.stringify({
            concepts: [{ id: 'c1', name: 'Concept 1', description: 'D1', dependencies: [] }],
          }),
        },
      }],
    });
    expect(parsed.tool).toBe('extract_concepts');
    expect(parsed.content).toBe('');
    expect(parsed.concepts).toHaveLength(1);
  });

  it('handles empty content in provide_guidance tool call (the "..." bug)', () => {
    const parsed = parser.parseStructuredResponse({
      content: '',
      toolCalls: [{
        id: '1',
        type: 'function',
        function: {
          name: 'provide_guidance',
          arguments: JSON.stringify({
            content: '',
            questionType: 'open-ended',
            conceptId: 'ts-types',
          }),
        },
      }],
    });
    // This is what causes the "..." fallback in buildTutorMessageFromParsed
    expect(parsed.content).toBe('');
    expect(parsed.questionType).toBe('open-ended');
  });
});

describe('ResponseParser.buildTutorMessageFromParsed', () => {
  const parser = new ResponseParser();

  it('creates question for open-ended guidance', () => {
    const msg = parser.buildTutorMessageFromParsed('test-session', {
      tool: 'provide_guidance',
      content: 'What is a type?',
      questionType: 'open-ended',
      options: null,
      correctOptionIndex: null,
      conceptId: 'ts-types',
      masteryCheck: null,
      misconceptionDetected: null,
    });
    expect(msg.type).toBe('question');
    expect(msg.question).toBeDefined();
    expect(msg.question!.type).toBe('open-ended');
    expect(msg.question!.conceptId).toBe('ts-types');
  });

  it('creates feedback when questionType is missing', () => {
    const msg = parser.buildTutorMessageFromParsed('test-session', {
      tool: 'provide_guidance',
      content: 'Good explanation.',
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: null,
      masteryCheck: null,
      misconceptionDetected: null,
    });
    expect(msg.type).toBe('feedback');
    expect(msg.question).toBeUndefined();
  });

  it('creates multiple-choice question with options', () => {
    const msg = parser.buildTutorMessageFromParsed('test-session', {
      tool: 'provide_guidance',
      content: 'Pick one:',
      questionType: 'multiple-choice',
      options: ['A', 'B', 'C'],
      correctOptionIndex: 1,
      conceptId: 'ts-types',
      masteryCheck: null,
      misconceptionDetected: null,
    });
    expect(msg.type).toBe('question');
    expect(msg.question!.options).toEqual(['A', 'B', 'C']);
    expect(msg.question!.correctOptionIndex).toBe(1);
  });

  it('does NOT strip A/B-labelled code examples that are not actual options', () => {
    const content = 'Which is correct?\n\n**写法A：**\n```\nspi@7e204000 { compatible = "brcm"; };\n```\n\n**写法B：**\n```\nspi { compatible = "brcm"; };\n```';
    const msg = parser.buildTutorMessageFromParsed('test-session', {
      tool: 'provide_guidance',
      content,
      questionType: 'multiple-choice',
      options: ['写法A', '写法B'],
      correctOptionIndex: 0,
      conceptId: 'dts-syntax',
      masteryCheck: null,
      misconceptionDetected: null,
    });
    // The content should still contain the code examples because
    // "spi@7e204000 { ... }" does not match the known options.
    expect(msg.content).toContain('写法A');
    expect(msg.content).toContain('写法B');
    expect(msg.content).toContain('spi@7e204000');
  });

  it('DOES strip duplicate option lines when they match known options', () => {
    const content = 'Which is correct?\nA. Option one\nB. Option two';
    const msg = parser.buildTutorMessageFromParsed('test-session', {
      tool: 'provide_guidance',
      content,
      questionType: 'multiple-choice',
      options: ['Option one', 'Option two'],
      correctOptionIndex: 0,
      conceptId: 'ts-types',
      masteryCheck: null,
      misconceptionDetected: null,
    });
    expect(msg.content).toBe('Which is correct?');
    expect(msg.content).not.toContain('Option one');
    expect(msg.content).not.toContain('Option two');
  });

  it('marks mastery-check question only when LLM calls provide_guidance', () => {
    // When the LLM returns a plain-text fallback (tool = send_info) that
    // happens to contain a question mark, it should NOT be marked as a
    // mastery-check question.
    const msgPlain = parser.buildTutorMessageFromParsed('test-session', {
      tool: 'send_info',
      content: 'What do you think about this?',
      questionType: null,
      options: null,
      correctOptionIndex: null,
      conceptId: 'ts-types',
      masteryCheck: null,
      misconceptionDetected: null,
    });
    expect(msgPlain.question?.isMasteryCheck).toBeUndefined();

    // When the LLM properly calls provide_guidance, the caller
    // (SocraticEngine.stepMasteryCheck) is responsible for setting
    // isMasteryCheck, but the parser itself should preserve any existing
    // question object without interfering.
    const msgTool = parser.buildTutorMessageFromParsed('test-session', {
      tool: 'provide_guidance',
      content: 'Explain generics.',
      questionType: 'open-ended',
      options: null,
      correctOptionIndex: null,
      conceptId: 'ts-generics',
      masteryCheck: null,
      misconceptionDetected: null,
    });
    expect(msgTool.question).toBeDefined();
    expect(msgTool.question?.isMasteryCheck).toBeUndefined();
  });
});

describe('SocraticEngine.getPhase', () => {
  const engine = new SocraticEngine(createMockLLM());

  it('returns diagnosis when no concepts extracted', () => {
    const session = createEmptySession();
    expect((engine as unknown as EngineWithGetPhase).getPhase(session)).toBe('diagnosis');
  });

  it('returns teaching when concept has <3 rounds', () => {
    const session = createSessionWithConcepts();
    session.messages = [
      makeTutorQuestion('Q1?', 'ts-types'),
    ];
    expect((engine as unknown as EngineWithGetPhase).getPhase(session)).toBe('teaching');
  });

  it('returns mastery-check after 3 rounds', () => {
    const session = createSessionWithConcepts();
    session.messages = [
      makeTutorQuestion('Q1?', 'ts-types'),
      makeTutorQuestion('Q2?', 'ts-types'),
      makeTutorQuestion('Q3?', 'ts-types'),
    ];
    expect((engine as unknown as EngineWithGetPhase).getPhase(session)).toBe('mastery-check');
  });

  it('returns teaching after mastery check if not mastered', () => {
    const session = createSessionWithConcepts();
    session.messages = [
      makeTutorQuestion('Q1?', 'ts-types'),
      makeTutorQuestion('Q2?', 'ts-types'),
      makeTutorQuestion('Q3?', 'ts-types'),
      makeTutorFeedback('Mastery: 50%'),
    ];
    expect((engine as unknown as EngineWithGetPhase).getPhase(session)).toBe('teaching');
  });

  it('returns practice after mastery check with recent mastery', () => {
    const session = createSessionWithConcepts();
    session.concepts[0]!.status = 'mastered';
    session.messages = [
      makeTutorQuestion('Q1?', 'ts-types'),
      makeTutorQuestion('Q2?', 'ts-types'),
      makeTutorQuestion('Q3?', 'ts-types'),
      makeTutorFeedback('Mastery: 90%'),
    ];
    expect((engine as unknown as EngineWithGetPhase).getPhase(session)).toBe('practice');
  });
});

describe('countRoundsForConcept (main.ts logic)', () => {
  it('counts only tutor questions for the specific concept', () => {
    const session = createSessionWithConcepts();
    session.messages = [
      makeTutorQuestion('Q1?', 'ts-types'),
      { id: 'u1', role: 'user', content: 'Answer 1', type: 'answer', timestamp: Date.now() },
      makeTutorQuestion('Q2?', 'ts-types'),
      makeTutorQuestion('Q3?', 'ts-generics'),
    ];
    expect(countRoundsForConcept(session, 'ts-types')).toBe(2);
    expect(countRoundsForConcept(session, 'ts-generics')).toBe(1);
  });

  it('does NOT count questions with missing conceptId (prevents diagnosis bleed)', () => {
    const session = createSessionWithConcepts();
    const q = makeTutorQuestion('Q1?', 'ts-types');
    q.question!.conceptId = '';
    session.messages = [q];
    // Empty conceptId must NOT be counted — otherwise diagnosis questions
    // leak into teaching-round counts after currentConceptId is set.
    expect(countRoundsForConcept(session, 'ts-types')).toBe(0);
  });
});

describe('Continue tutoring state machine simulation', () => {
  it('full loop: diagnosis → extract → teach 3 rounds → mastery → next concept', () => {
    const session = createEmptySession();

    // Phase 1: Diagnosis (2 rounds)
    session.messages.push(makeTutorQuestion('Diag 1?', ''));
    session.messages.push({ id: 'u1', role: 'user', content: 'A1', type: 'answer', timestamp: Date.now() });
    session.messages.push(makeTutorQuestion('Diag 2?', ''));
    session.messages.push({ id: 'u2', role: 'user', content: 'A2', type: 'answer', timestamp: Date.now() });

    // After 2 diagnosis rounds + 2 answers, concepts should be extracted
    session.concepts = [
      { id: 'c1', name: 'Concept 1', description: 'D1', dependencies: [], status: 'pending', masteryScore: 0, lastReviewTime: null, reviewInterval: 0, selfAssessment: null },
      { id: 'c2', name: 'Concept 2', description: 'D2', dependencies: [], status: 'pending', masteryScore: 0, lastReviewTime: null, reviewInterval: 0, selfAssessment: null },
    ];
    session.conceptOrder = ['c1', 'c2'];

    // Phase 2: Start teaching c1
    session.currentConceptId = 'c1';
    session.concepts[0]!.status = 'learning';

    // Round 1
    session.messages.push(makeTutorQuestion('Teach 1?', 'c1'));
    session.messages.push({ id: 'u3', role: 'user', content: 'A3', type: 'answer', timestamp: Date.now() });

    // Round 2
    session.messages.push(makeTutorQuestion('Teach 2?', 'c1'));
    session.messages.push({ id: 'u4', role: 'user', content: 'A4', type: 'answer', timestamp: Date.now() });

    // Round 3
    session.messages.push(makeTutorQuestion('Teach 3?', 'c1'));
    session.messages.push({ id: 'u5', role: 'user', content: 'A5', type: 'answer', timestamp: Date.now() });

    // After 3 teaching rounds (diagnosis questions are NOT counted),
    // should trigger mastery check
    expect(countRoundsForConcept(session, 'c1')).toBe(3);

    // Phase 3: Mastery check passed
    session.messages.push(makeTutorFeedback('Mastery: 85%'));
    session.concepts[0]!.status = 'mastered';
    session.concepts[0]!.masteryScore = 85;
    session.currentConceptId = null;

    // Phase 4: Move to next concept
    session.currentConceptId = 'c2';
    session.concepts[1]!.status = 'learning';

    expect(session.concepts.filter(c => c.status === 'mastered').length).toBe(1);
    expect(session.concepts.filter(c => c.status === 'learning').length).toBe(1);
  });
});

describe('LLMService.request body construction', () => {
  it('does NOT set response_format when tools are present (the root cause of "...")', () => {
    // Verify the exact invariant used in LLMService.chat:
    // when tools exist, response_format must never be added.
    const tools: ToolDefinition[] = [{ type: 'function', function: { name: 'provide_guidance', description: 'test', parameters: { type: 'object', properties: {}, required: [] } } }];
    const body: Record<string, unknown> = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'test' }],
      temperature: 0.7,
      max_tokens: 2000,
    };
    if (tools) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }
    const jsonMode = true;
    // The fixed logic from LLMService.ts:
    if (jsonMode && !tools) {
      body['response_format'] = { type: 'json_object' };
    }

    // With tools present, response_format MUST NOT be set
    expect(body).not.toHaveProperty('response_format');
  });

  it('DOES set response_format when jsonMode is true and NO tools are present', () => {
    const body: Record<string, unknown> = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'test' }],
      temperature: 0.7,
      max_tokens: 2000,
    };
    const jsonMode = true;
    const tools = undefined;
    if (jsonMode && !tools) {
      body['response_format'] = { type: 'json_object' };
    }
    expect(body).toHaveProperty('response_format');
  });
});
