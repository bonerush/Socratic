import type { SessionState, ConceptState } from '../types';
import { getToolDescriptions } from './tools';
import {
  IDENTITY_BLOCK_CONTENT,
  CORE_RULES_BLOCK_CONTENT,
  METHODOLOGY_BLOCK_CONTENT,
  RESPONSE_FORMAT_BLOCK_CONTENT,
  getPhaseDescription,
  buildDiagnosisPrompt as buildDiagnosisPromptText,
  buildConceptExtractionPrompt as buildConceptExtractionPromptText,
  buildMasteryCheckPrompt as buildMasteryCheckPromptText,
  buildMasteryAssessPrompt as buildMasteryAssessPromptText,
  buildExplainSelectionPrompt as buildExplainSelectionPromptText,
  buildConversationSummaryPrompt as buildConversationSummaryPromptText,
} from '../prompts/content';

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
  content: IDENTITY_BLOCK_CONTENT,
};

const CORE_RULES_BLOCK: PromptBlock = {
  id: 'core-rules',
  priority: P_CORE_RULES,
  content: CORE_RULES_BLOCK_CONTENT,
};

const METHODOLOGY_BLOCK: PromptBlock = {
  id: 'methodology',
  priority: P_METHODOLOGY,
  content: METHODOLOGY_BLOCK_CONTENT,
};

function buildToolsBlock(phase: string): PromptBlock {
  return {
    id: 'tools',
    priority: P_TOOLS,
    content: `## Available Tools\nYou MUST call one of the following tools for EVERY response. Do NOT output plain text — plain text will be ignored by the system.\n\n${getToolDescriptions(phase)}`,
  };
}

const RESPONSE_FORMAT_BLOCK: PromptBlock = {
  id: 'response-format',
  priority: P_RESPONSE_FORMAT,
  content: RESPONSE_FORMAT_BLOCK_CONTENT,
};

// ── Dynamic block builders ──────────────────────────────────

function buildPhaseBlock(phase: string, currentConceptName?: string): PromptBlock {
  return {
    id: 'phase',
    priority: P_PHASE,
    content: `## Current Phase\n${getPhaseDescription(phase, currentConceptName)}`,
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
    return buildDiagnosisPromptText();
  }

  buildConceptExtractionPrompt(): string {
    return buildConceptExtractionPromptText();
  }

  buildMasteryCheckPrompt(conceptName: string, conceptId: string): string {
    return buildMasteryCheckPromptText(conceptName, conceptId);
  }

  buildMasteryAssessPrompt(conceptName: string): string {
    return buildMasteryAssessPromptText(conceptName);
  }

  buildExplainSelectionPrompt(selection: string): string {
    return buildExplainSelectionPromptText(selection);
  }

  buildConversationSummaryPrompt(messages: { role: string; content: string }[]): string {
    return buildConversationSummaryPromptText(messages);
  }
}
