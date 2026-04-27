import type { TraceEvent } from './Tracer';

export interface TraceAnalysis {
  sessionSlug: string;
  eventCount: number;
  llmCallCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  selfCorrectionCount: number;
  healingAttemptCount: number;
  phases: { phase: string; durationMs: number }[];
  errors: { timestamp: number; message: string }[];
}

/**
 * Analyze a stream of trace events to produce aggregate statistics.
 */
export class TraceAnalyzer {
  analyze(events: TraceEvent[]): TraceAnalysis {
    const sessionSlug = events[0]?.sessionSlug ?? 'unknown';
    const llmCalls = events.filter((e) => e.type === 'llm-request');
    const responses = events.filter((e) => e.type === 'llm-response');

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    for (const r of responses) {
      const usage = r.data.usage as { promptTokens?: number; completionTokens?: number } | undefined;
      if (usage) {
        totalPromptTokens += usage.promptTokens ?? 0;
        totalCompletionTokens += usage.completionTokens ?? 0;
      }
    }

    // Compute phase durations by matching phase-start with phase-end
    const phaseStarts = new Map<string, number>();
    const phases: { phase: string; durationMs: number }[] = [];
    for (const e of events) {
      if (e.type === 'phase-start' && e.phase) {
        phaseStarts.set(e.phase, e.timestamp);
      } else if (e.type === 'phase-end' && e.phase) {
        const start = phaseStarts.get(e.phase);
        if (start) {
          phases.push({ phase: e.phase, durationMs: e.timestamp - start });
          phaseStarts.delete(e.phase);
        }
      }
    }

    const errors = events
      .filter((e) => e.type === 'llm-error')
      .map((e) => ({
        timestamp: e.timestamp,
        message: String(e.data.message ?? 'Unknown error'),
      }));

    return {
      sessionSlug,
      eventCount: events.length,
      llmCallCount: llmCalls.length,
      totalPromptTokens,
      totalCompletionTokens,
      selfCorrectionCount: events.filter((e) => e.type === 'self-correction').length,
      healingAttemptCount: events.filter((e) => e.type === 'healing-attempt').length,
      phases,
      errors,
    };
  }

  formatAnalysis(analysis: TraceAnalysis): string {
    const lines: string[] = [`# Trace Analysis: ${analysis.sessionSlug}`, ''];

    lines.push('## Overview');
    lines.push(`- Total events: ${analysis.eventCount}`);
    lines.push(`- LLM calls: ${analysis.llmCallCount}`);
    lines.push(`- Self-corrections: ${analysis.selfCorrectionCount}`);
    lines.push(`- Healing attempts: ${analysis.healingAttemptCount}`);
    lines.push('');

    if (analysis.totalPromptTokens > 0 || analysis.totalCompletionTokens > 0) {
      lines.push('## Token Usage');
      lines.push(`- Prompt tokens: ${analysis.totalPromptTokens}`);
      lines.push(`- Completion tokens: ${analysis.totalCompletionTokens}`);
      lines.push(`- Total: ${analysis.totalPromptTokens + analysis.totalCompletionTokens}`);
      lines.push('');
    }

    if (analysis.phases.length > 0) {
      lines.push('## Phase Durations');
      for (const p of analysis.phases) {
        lines.push(`- ${p.phase}: ${p.durationMs}ms`);
      }
      lines.push('');
    }

    if (analysis.errors.length > 0) {
      lines.push('## Errors');
      for (const err of analysis.errors) {
        lines.push(`- ${new Date(err.timestamp).toISOString()}: ${err.message}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
