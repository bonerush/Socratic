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
      name: 'ask_question',
      description:
        'Ask the student a Socratic question. For multiple-choice, provide 2-5 options and the correct index. For open-ended, leave options empty.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The question text.' },
          questionType: {
            type: 'string',
            enum: ['multiple-choice', 'open-ended'],
            description: 'Type of question.',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Options for multiple-choice questions.',
          },
          correctOptionIndex: {
            type: 'number',
            description: 'Zero-based index of the correct option.',
          },
          conceptId: {
            type: 'string',
            description: 'ID of the concept this question targets.',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'provide_guidance',
      description:
        'Provide guidance, hints, feedback, or a counter-example to help the student discover the answer. Never give the answer directly.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The guidance text.' },
          conceptId: { type: 'string', description: 'ID of the concept this guidance targets.' },
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
        "Assess the student's mastery of a concept across four dimensions: correctness, explanation depth, novel application, and concept discrimination.",
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
        'Extract atomic concepts from the note content that the student needs to master. Return 5-15 concepts ordered from foundational to advanced.',
      parameters: {
        type: 'object',
        properties: {
          concepts: {
            type: 'array',
            description: 'List of extracted concepts.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique slug-style ID.' },
                name: { type: 'string', description: 'Human-readable concept name.' },
                description: { type: 'string', description: 'Brief description.' },
                dependencies: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs of prerequisite concepts.',
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
        'Send an informational message to the student (e.g. session transition, concept mastered notification). Use sparingly.',
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

export function getToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS;
}

export function getToolDescriptions(): string {
  return TOOL_DEFINITIONS
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

export interface ValidatedToolCall {
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
