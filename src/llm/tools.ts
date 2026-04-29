/**
 * Simplified tool definitions for LLM function calling.
 *
 * Previously this was a 7-file class-based system with registries and
 * validators. The classes added ~400 lines of boilerplate but their
 * execute() methods were all identity functions (return args) and the
 * engine already has a lenient JSON fallback path. We keep only:
 * - The OpenAI-compatible shape types
 * - Static schema definitions
 * - A lightweight argument parser for the happy path
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'provide_guidance',
      description:
        'REQUIRED: Use this tool for EVERY teaching interaction. Your message should: (a) briefly correct any misconceptions if needed, (b) give hints or explanations to guide thinking, (c) end with a Socratic question. Never give the answer directly. CRITICAL: For multiple-choice questions, you MUST populate the "options" array (2-5 items) AND "correctOptionIndex". For open-ended questions, set "questionType" to "open-ended" and omit "options".',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The guidance text or question text. Must be substantive and include the actual question.' },
          conceptId: { type: 'string', description: 'ID of the concept this guidance targets.' },
          questionType: {
            type: 'string',
            enum: ['multiple-choice', 'open-ended'],
            description: 'REQUIRED when including a question. Set to "multiple-choice" or "open-ended".',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'REQUIRED for multiple-choice: 2-5 option strings. Each option should be the text only, without "A.", "B." prefixes.',
          },
          correctOptionIndex: {
            type: 'number',
            description: 'REQUIRED for multiple-choice: zero-based index of the correct option (0, 1, 2, or 3).',
          },
          misconception: {
            type: 'string',
            description: 'If a misconception was detected, describe it.',
          },
          rootCause: {
            type: 'string',
            description: 'Inferred root cause of the misconception.',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assess_mastery',
      description:
        'REQUIRED: Use this tool when evaluating student mastery. Assess across all four dimensions and return a structured evaluation.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Assessment feedback text.' },
          conceptId: { type: 'string', description: 'ID of the concept being assessed.' },
          correctness: {
            type: 'boolean',
            description: 'Did the student answer factually correctly?',
          },
          explanationDepth: {
            type: 'boolean',
            description: 'Could the student explain the "why"?',
          },
          novelApplication: {
            type: 'boolean',
            description: 'Could the student apply the concept to a novel scenario?',
          },
          conceptDiscrimination: {
            type: 'boolean',
            description: 'Can the student distinguish this concept from similar ones?',
          },
        },
        required: ['content', 'correctness', 'explanationDepth', 'novelApplication', 'conceptDiscrimination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_concepts',
      description:
        'REQUIRED: Use this tool to extract atomic concepts from the note content. Return 5-15 concepts ordered from foundational to advanced.',
      parameters: {
        type: 'object',
        properties: {
          concepts: {
            type: 'array',
            description: 'List of extracted concepts. MUST contain at least 5 items.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique slug-style ID (e.g. "kernel-space").' },
                name: { type: 'string', description: 'Human-readable concept name.' },
                description: { type: 'string', description: 'Brief description of what the student needs to understand.' },
                dependencies: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs of prerequisite concepts that should be learned first.',
                },
              },
              required: ['id', 'name', 'description', 'dependencies'],
            },
          },
        },
        required: ['concepts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_info',
      description:
        'Use this tool ONLY for session transitions, completion notifications, or when no teaching question is needed. For all teaching interactions, use provide_guidance instead.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The informational message.' },
          conceptId: {
            type: 'string',
            description: 'ID of the related concept, if any.',
          },
        },
        required: ['content'],
      },
    },
  },
];

export function getToolDefinitionsForPhase(phase: string): ToolDefinition[] {
  switch (phase) {
    case 'diagnosis':
    case 'teaching':
    case 'practice':
    case 'review':
      return TOOL_DEFINITIONS.filter((d) => d.function.name === 'provide_guidance');
    case 'mastery-check':
      return TOOL_DEFINITIONS.filter((d) => d.function.name === 'provide_guidance');
    case 'mastery-assess':
      return TOOL_DEFINITIONS.filter((d) => d.function.name === 'assess_mastery');
    case 'extract_concepts':
      return TOOL_DEFINITIONS.filter((d) => d.function.name === 'extract_concepts');
    case 'finalize':
      return TOOL_DEFINITIONS.filter((d) => d.function.name === 'send_info');
    default:
      return TOOL_DEFINITIONS;
  }
}

export function getToolDescriptions(phase?: string): string {
  const defs = phase ? getToolDefinitionsForPhase(phase) : TOOL_DEFINITIONS;
  return defs
    .map((def) => {
      const fn = def.function;
      const params = fn.parameters.properties as Record<string, { description?: string; enum?: string[] }>;
      const paramDesc = Object.entries(params)
        .map(([key, val]) => `  - ${key}: ${val.description ?? ''}${val.enum ? ` (enum: ${val.enum.join(', ')})` : ''}`)
        .join('\n');
      return `## ${fn.name}\n${fn.description}\nParameters:\n${paramDesc}`;
    })
    .join('\n\n');
}

interface ValidatedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export function validateToolCalls(toolCalls: ToolCall[]): {
  valid: ValidatedToolCall[];
  invalid: { call: ToolCall; errors: string[] }[];
} {
  const valid: ValidatedToolCall[] = [];
  const invalid: { call: ToolCall; errors: string[] }[] = [];

  for (const call of toolCalls) {
    const known = TOOL_DEFINITIONS.some((d) => d.function.name === call.function.name);
    if (!known) {
      invalid.push({ call, errors: [`Unknown tool: "${call.function.name}"`] });
      continue;
    }
    try {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      valid.push({ name: call.function.name, args });
    } catch {
      invalid.push({ call, errors: ['Invalid JSON in tool call arguments'] });
    }
  }

  return { valid, invalid };
}
