import type { SessionState } from '../types';
import type { TraceEvent } from './Tracer';
import { SessionDebugger } from './SessionDebugger';
import { TraceAnalyzer } from './TraceAnalyzer';
import { ConceptGraphBuilder } from './ConceptGraphBuilder';
import { MessageInspector } from './MessageInspector';

export interface FullDebugReport {
  markdown: string;
  healthy: boolean;
  issueCount: number;
}

/**
 * Generates a comprehensive debug report by combining all diagnostic tools.
 */
export class DebugReporter {
  private sessionDebugger = new SessionDebugger();
  private traceAnalyzer = new TraceAnalyzer();
  private graphBuilder = new ConceptGraphBuilder();
  private messageInspector = new MessageInspector();

  generateSessionReport(state: SessionState): FullDebugReport {
    const diagnostic = this.sessionDebugger.diagnose(state);
    const graphReport = this.graphBuilder.build(state);
    const messageReport = this.messageInspector.inspect(state);

    const lines: string[] = ['# Debug Report', ''];

    // ── Summary ──
    const totalIssues =
      diagnostic.issues.length +
      graphReport.isolatedConcepts.length +
      graphReport.missingDependencies.length +
      messageReport.duplicateMessages.length +
      messageReport.consecutiveUserMessages.length +
      messageReport.emptyOrPlaceholderMessages.length;

    lines.push(`## Summary`);
    lines.push(`- Status: ${totalIssues === 0 ? 'All Clear' : `${totalIssues} issue(s) found`}`);
    lines.push('');

    // ── Session Health ──
    lines.push(`## Session Health`);
    lines.push(`- Healthy: ${diagnostic.healthy ? 'Yes' : 'No'}`);
    lines.push(`- Total messages: ${diagnostic.stats.totalMessages}`);
    lines.push(`- Concepts: ${diagnostic.stats.conceptsTotal} (${diagnostic.stats.conceptsMastered} mastered)`);
    lines.push(`- Avg mastery: ${diagnostic.stats.avgMasteryScore}%`);
    lines.push('');

    // ── Issues ──
    if (diagnostic.issues.length > 0) {
      lines.push('## Issues');
      for (const issue of diagnostic.issues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }

    // ── Concept Graph ──
    lines.push('## Concept Graph');
    lines.push(`- Max dependency depth: ${graphReport.maxDependencyDepth}`);
    if (graphReport.isolatedConcepts.length > 0) {
      lines.push(`- Isolated concepts: ${graphReport.isolatedConcepts.join(', ')}`);
    }
    if (graphReport.missingDependencies.length > 0) {
      lines.push(`- Missing dependencies:`);
      for (const m of graphReport.missingDependencies) {
        lines.push(`  - ${m.conceptId} → ${m.missingId}`);
      }
    }
    lines.push('');
    lines.push('### Dependency Diagram');
    lines.push('```mermaid');
    lines.push(graphReport.mermaidDiagram);
    lines.push('```');
    lines.push('');

    // ── Message Inspection ──
    const msgIssues =
      messageReport.duplicateMessages.length +
      messageReport.suspiciouslyShortAnswers.length +
      messageReport.unusuallyLongAnswers.length +
      messageReport.consecutiveUserMessages.length +
      messageReport.emptyOrPlaceholderMessages.length +
      messageReport.responseTimeGaps.length;

    if (msgIssues > 0) {
      lines.push('## Message Inspection');
      if (messageReport.duplicateMessages.length > 0) {
        lines.push(`- Duplicate messages: ${messageReport.duplicateMessages.length}`);
      }
      if (messageReport.suspiciouslyShortAnswers.length > 0) {
        lines.push(`- Suspiciously short answers: ${messageReport.suspiciouslyShortAnswers.length}`);
      }
      if (messageReport.unusuallyLongAnswers.length > 0) {
        lines.push(`- Unusually long answers: ${messageReport.unusuallyLongAnswers.length}`);
      }
      if (messageReport.consecutiveUserMessages.length > 0) {
        lines.push(`- Consecutive user messages: ${messageReport.consecutiveUserMessages.length}`);
      }
      if (messageReport.emptyOrPlaceholderMessages.length > 0) {
        lines.push(`- Empty/placeholder messages: ${messageReport.emptyOrPlaceholderMessages.length}`);
      }
      if (messageReport.responseTimeGaps.length > 0) {
        lines.push(`- Large response gaps: ${messageReport.responseTimeGaps.length}`);
      }
      lines.push('');
    }

    return {
      markdown: lines.join('\n'),
      healthy: totalIssues === 0,
      issueCount: totalIssues,
    };
  }

  generateTraceReport(events: TraceEvent[]): string {
    const analysis = this.traceAnalyzer.analyze(events);
    return this.traceAnalyzer.formatAnalysis(analysis);
  }
}
