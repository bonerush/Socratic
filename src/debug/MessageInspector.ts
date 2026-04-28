import type { SessionState, TutorMessage } from '../types';

export interface MessageInspectionReport {
  /** Messages with identical content (potential duplicates) */
  duplicateMessages: { content: string; count: number; ids: string[] }[];
  /** User messages that are unusually short (< 3 chars) */
  suspiciouslyShortAnswers: string[];
  /** User messages that are unusually long (> 500 chars) */
  unusuallyLongAnswers: string[];
  /** Places where the user sent multiple messages without a tutor response in between */
  consecutiveUserMessages: { firstId: string; secondId: string }[];
  /** Time gaps between messages (in ms) */
  responseTimeGaps: { afterMessageId: string; gapMs: number }[];
  /** Messages that appear to be empty or placeholder */
  emptyOrPlaceholderMessages: string[];
}

const SHORT_ANSWER_THRESHOLD = 3;
const LONG_ANSWER_THRESHOLD = 500;
const LARGE_GAP_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Inspects message sequences for anomalies and quality issues.
 */
export class MessageInspector {
  inspect(state: SessionState): MessageInspectionReport {
    const messages = state.messages;

    return {
      duplicateMessages: this.findDuplicates(messages),
      suspiciouslyShortAnswers: this.findShortAnswers(messages),
      unusuallyLongAnswers: this.findLongAnswers(messages),
      consecutiveUserMessages: this.findConsecutiveUserMessages(messages),
      responseTimeGaps: this.findLargeGaps(messages),
      emptyOrPlaceholderMessages: this.findEmptyMessages(messages),
    };
  }

  private findDuplicates(messages: TutorMessage[]): { content: string; count: number; ids: string[] }[] {
    const groups = new Map<string, string[]>();
    for (const m of messages) {
      const normalized = m.content.trim().toLowerCase();
      if (!normalized) continue;
      const existing = groups.get(normalized) ?? [];
      existing.push(m.id);
      groups.set(normalized, existing);
    }

    return Array.from(groups.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([content, ids]) => ({ content, count: ids.length, ids }));
  }

  private findShortAnswers(messages: TutorMessage[]): string[] {
    return messages
      .filter((m) => m.role === 'user' && m.content.trim().length < SHORT_ANSWER_THRESHOLD)
      .map((m) => m.id);
  }

  private findLongAnswers(messages: TutorMessage[]): string[] {
    return messages
      .filter((m) => m.role === 'user' && m.content.trim().length > LONG_ANSWER_THRESHOLD)
      .map((m) => m.id);
  }

  private findConsecutiveUserMessages(
    messages: TutorMessage[],
  ): { firstId: string; secondId: string }[] {
    const result: { firstId: string; secondId: string }[] = [];
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1]!;
      const curr = messages[i]!;
      if (prev.role === 'user' && curr.role === 'user') {
        result.push({ firstId: prev.id, secondId: curr.id });
      }
    }
    return result;
  }

  private findLargeGaps(messages: TutorMessage[]): { afterMessageId: string; gapMs: number }[] {
    const result: { afterMessageId: string; gapMs: number }[] = [];
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1]!;
      const curr = messages[i]!;
      const gap = curr.timestamp - prev.timestamp;
      if (gap > LARGE_GAP_MS) {
        result.push({ afterMessageId: prev.id, gapMs: gap });
      }
    }
    return result;
  }

  private findEmptyMessages(messages: TutorMessage[]): string[] {
    return messages
      .filter((m) => !m.content.trim() || m.content.trim() === '...')
      .map((m) => m.id);
  }
}
