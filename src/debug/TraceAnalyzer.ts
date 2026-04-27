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
  avgLlmResponseTimeMs: number;
  errorRate: number;
  selfCorrectionRate: number;
  healingRate: number;
  mostExpensivePhase: { phase: string; durationMs: number } | null;
  tokenEfficiency: number;
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

    const selfCorrectionCount = events.filter((e) => e.type === 'self-correction').length;
    const healingAttemptCount = events.filter((e) => e.type === 'healing-attempt').length;
    const llmCallCount = llmCalls.length;

    // 1. Average LLM response time
    let totalResponseTime = 0;
    let responseTimeCount = 0;
    for (let i = 0; i < events.length; i++) {
      const req = events[i];
      if (req && req.type === 'llm-request') {
        const responseEvent = events.slice(i + 1).find((e) => e.type === 'llm-response');
        if (responseEvent) {
          totalResponseTime += responseEvent.timestamp - req.timestamp;
          responseTimeCount++;
        }
      }
    }
    const avgLlmResponseTimeMs = responseTimeCount > 0 ? Math.round(totalResponseTime / responseTimeCount) : 0;

    // 2. Error rate
    const errorRate = llmCallCount > 0 ? errors.length / llmCallCount : 0;

    // 3. Self-correction rate
    const selfCorrectionRate = llmCallCount > 0 ? selfCorrectionCount / llmCallCount : 0;

    // 4. Healing rate
    const healingRate = llmCallCount > 0 ? healingAttemptCount / llmCallCount : 0;

    // 5. Most expensive phase
    const phaseTotals = new Map<string, number>();
    for (const p of phases) {
      phaseTotals.set(p.phase, (phaseTotals.get(p.phase) ?? 0) + p.durationMs);
    }
    let mostExpensivePhase: { phase: string; durationMs: number } | null = null;
    for (const [phase, durationMs] of phaseTotals) {
      if (!mostExpensivePhase || durationMs > mostExpensivePhase.durationMs) {
        mostExpensivePhase = { phase, durationMs };
      }
    }

    // 6. Token efficiency
    const tokenEfficiency = llmCallCount > 0 ? totalCompletionTokens / llmCallCount : 0;

    return {
      sessionSlug,
      eventCount: events.length,
      llmCallCount,
      totalPromptTokens,
      totalCompletionTokens,
      selfCorrectionCount,
      healingAttemptCount,
      phases,
      errors,
      avgLlmResponseTimeMs,
      errorRate,
      selfCorrectionRate,
      healingRate,
      mostExpensivePhase,
      tokenEfficiency,
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

    lines.push('## Performance');
    lines.push(`- Average LLM response time: ${analysis.avgLlmResponseTimeMs}ms`);
    if (analysis.mostExpensivePhase) {
      lines.push(`- Most expensive phase: ${analysis.mostExpensivePhase.phase} (${analysis.mostExpensivePhase.durationMs}ms)`);
    }
    lines.push('');

    lines.push('## Rates');
    lines.push(`- Error rate: ${(analysis.errorRate * 100).toFixed(1)}%`);
    lines.push(`- Self-correction rate: ${(analysis.selfCorrectionRate * 100).toFixed(1)}%`);
    lines.push(`- Healing rate: ${(analysis.healingRate * 100).toFixed(1)}%`);
    lines.push('');

    if (analysis.totalPromptTokens > 0 || analysis.totalCompletionTokens > 0) {
      lines.push('## Token Usage');
      lines.push(`- Prompt tokens: ${analysis.totalPromptTokens}`);
      lines.push(`- Completion tokens: ${analysis.totalCompletionTokens}`);
      lines.push(`- Total: ${analysis.totalPromptTokens + analysis.totalCompletionTokens}`);
      lines.push(`- Token efficiency (completion/call): ${analysis.tokenEfficiency.toFixed(1)}`);
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
