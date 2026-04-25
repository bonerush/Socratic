/**
 * Tool definitions for LLM function calling.
 *
 * The LLM can invoke these tools during tutoring:
 * - ask_question: Ask questions (multiple-choice or open-ended)
 * - provide_guidance: Give Socratic guidance/feedback
 * - assess_mastery: Evaluate concept mastery
 * - extract_concepts: Extract learning concepts from note
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
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

export interface MultipleChoiceArgs {
  content: string;
  options: string[];
  correctOptionIndex?: number;
  conceptId?: string;
}

export interface GuidanceArgs {
  content: string;
  misconception?: string;
  rootCause?: string;
  conceptId?: string;
}

export interface MasteryCheckArgs {
  content: string;
  correctness: boolean;
  explanationDepth: boolean;
  novelApplication: boolean;
  conceptDiscrimination: boolean;
  conceptId?: string;
}

export interface ConceptExtractionArgs {
  concepts: Array<{
    id: string;
    name: string;
    description: string;
    dependencies: string[];
  }>;
}

export interface InfoArgs {
  content: string;
  conceptId?: string;
}

export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'ask_question',
      description: 'Ask the student a question. Use this for multiple-choice questions (选择题) or open-ended questions (解答题). For multiple-choice, provide options and optionally the correct index. For open-ended, omit options.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The question text to display to the student',
          },
          questionType: {
            type: 'string',
            enum: ['multiple-choice', 'open-ended'],
            description: 'Whether this is a multiple-choice or open-ended question',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Required for multiple-choice: the answer options (A, B, C, D)',
          },
          correctOptionIndex: {
            type: 'number',
            description: 'Index of the correct option (0-based) — used for internal tracking',
          },
          conceptId: {
            type: 'string',
            description: 'ID of the concept this question is testing',
          },
        },
        required: ['content', 'questionType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'provide_guidance',
      description: 'Give Socratic guidance, hints, or feedback to the student. Never give direct answers — only guide through questions and hints. Optionally report a detected misconception.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The guidance message to display to the student',
          },
          misconception: {
            type: 'string',
            description: 'If a misconception is detected, describe it here',
          },
          rootCause: {
            type: 'string',
            description: 'The inferred root cause of the misconception',
          },
          conceptId: {
            type: 'string',
            description: 'ID of the related concept',
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
      description: 'Assess the student\'s mastery of a concept across 4 dimensions. Only call this after asking sufficient questions to evaluate all dimensions.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Summary of the mastery assessment for the student',
          },
          correctness: {
            type: 'boolean',
            description: 'Whether the student demonstrated factual accuracy',
          },
          explanationDepth: {
            type: 'boolean',
            description: 'Whether the student can explain "why"',
          },
          novelApplication: {
            type: 'boolean',
            description: 'Whether the student can handle unseen scenarios',
          },
          conceptDiscrimination: {
            type: 'boolean',
            description: 'Whether the student can distinguish from similar concepts',
          },
          conceptId: {
            type: 'string',
            description: 'ID of the concept being assessed',
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
      description: 'Extract learning concepts from the note content. Call this after the diagnosis phase to identify what topics to teach.',
      parameters: {
        type: 'object',
        properties: {
          concepts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Unique slug ID (e.g., "python-decorators")',
                },
                name: {
                  type: 'string',
                  description: 'Clear concept name',
                },
                description: {
                  type: 'string',
                  description: 'Brief description of the concept',
                },
                dependencies: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs of concepts that should be learned before this one',
                },
              },
              required: ['id', 'name', 'description', 'dependencies'],
            },
            description: 'Array of extracted concepts, ordered from foundational to advanced',
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
      description: 'Send an informational message to the student (progress updates, transitions, etc.).',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The informational message to display',
          },
          conceptId: {
            type: 'string',
            description: 'ID of the related concept (if any)',
          },
        },
        required: ['content'],
      },
    },
  },
];

export type ToolName = (typeof TOOLS)[number]['function']['name'];

export function getToolDescriptions(): string {
  return TOOLS.map(t => {
    const fn = t.function;
    const props = fn.parameters.properties as Record<string, { description?: string; enum?: string[] }>;
    const paramDesc = Object.entries(props)
      .map(([key, val]) => `  - ${key}: ${val.description || ''}${val.enum ? ` (enum: ${val.enum.join(', ')})` : ''}`)
      .join('\n');
    return `## ${fn.name}\n${fn.description}\nParameters:\n${paramDesc}`;
  }).join('\n\n');
}
