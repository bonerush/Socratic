import type { SessionState, ConceptState, TutorMessage } from '../types';

export interface SessionDiagnostic {
  healthy: boolean;
  issues: string[];
  stats: SessionStats;
}

export interface SessionStats {
  totalMessages: number;
  tutorMessages: number;
  userMessages: number;
  conceptsTotal: number;
  conceptsMastered: number;
  conceptsLearning: number;
  conceptsPending: number;
  misconceptionsTotal: number;
  misconceptionsUnresolved: number;
  avgMasteryScore: number;
  teachingRounds: number;
  diagnosisRounds: number;
}

/**
 * Diagnose a session state for inconsistencies and generate statistics.
 * Used by the debug panel and trace analyzer.
 */
export class SessionDebugger {
  diagnose(state: SessionState): SessionDiagnostic {
    const issues: string[] = [];

    // Check concept order consistency
    const orderedIds = new Set(state.conceptOrder);
    const actualIds = new Set(state.concepts.map((c) => c.id));
    if (orderedIds.size !== actualIds.size) {
      issues.push(
        `Concept count mismatch: conceptOrder has ${orderedIds.size} entries, concepts array has ${actualIds.size}`
      );
    }
    for (const id of orderedIds) {
      if (!actualIds.has(id)) {
        issues.push(`conceptOrder references missing concept: "${id}"`);
      }
    }
    for (const id of actualIds) {
      if (!orderedIds.has(id)) {
        issues.push(`Concept "${id}" not found in conceptOrder`);
      }
    }

    // Check currentConceptId validity
    if (state.currentConceptId && !actualIds.has(state.currentConceptId)) {
      issues.push(`currentConceptId "${state.currentConceptId}" does not exist in concepts`);
    }

    // Check for messages without valid concept references
    const tutorQuestions = state.messages.filter(
      (m) => m.role === 'tutor' && m.type === 'question' && m.question?.conceptId
    );
    for (const msg of tutorQuestions) {
      const cid = msg.question!.conceptId;
      if (cid && !actualIds.has(cid)) {
        issues.push(`Message ${msg.id} references unknown concept: "${cid}"`);
      }
    }

    // Check for dangling misconceptions
    for (const m of state.misconceptions) {
      if (!state.concepts.some((c) => c.id === m.conceptId)) {
        issues.push(`Misconception "${m.id}" references unknown concept "${m.conceptId}"`);
      }
    }

    // Check for empty session with completion flag
    if (state.completed && state.concepts.length === 0 && state.messages.length < 3) {
      issues.push('Session marked completed but has minimal content');
    }

    const stats = this.computeStats(state);

    return {
      healthy: issues.length === 0,
      issues,
      stats,
    };
  }

  computeStats(state: SessionState): SessionStats {
    const tutorMsgs = state.messages.filter((m) => m.role === 'tutor');
    const userMsgs = state.messages.filter((m) => m.role === 'user');
    const mastered = state.concepts.filter((c) => c.status === 'mastered');
    const learning = state.concepts.filter((c) => c.status === 'learning');
    const pending = state.concepts.filter((c) => c.status === 'pending');

    const masterySum = state.concepts.reduce((sum, c) => sum + c.masteryScore, 0);

    const diagnosisRounds = tutorMsgs.filter(
      (m) => m.type === 'question' && (!m.question?.conceptId || m.question.conceptId === '')
    ).length;

    const teachingRounds = tutorMsgs.filter(
      (m) => m.type === 'question' && m.question?.conceptId
    ).length;

    return {
      totalMessages: state.messages.length,
      tutorMessages: tutorMsgs.length,
      userMessages: userMsgs.length,
      conceptsTotal: state.concepts.length,
      conceptsMastered: mastered.length,
      conceptsLearning: learning.length,
      conceptsPending: pending.length,
      misconceptionsTotal: state.misconceptions.length,
      misconceptionsUnresolved: state.misconceptions.filter((m) => !m.resolved).length,
      avgMasteryScore: state.concepts.length > 0 ? Math.round(masterySum / state.concepts.length) : 0,
      teachingRounds,
      diagnosisRounds,
    };
  }

  /**
   * Format a diagnostic report as human-readable markdown.
   */
  formatReport(diag: SessionDiagnostic): string {
    const lines: string[] = ['# Session Diagnostic Report', ''];

    lines.push(`## Status: ${diag.healthy ? 'Healthy' : 'Issues Found'}`);
    lines.push('');

    if (diag.issues.length > 0) {
      lines.push('### Issues');
      for (const issue of diag.issues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }

    const s = diag.stats;
    lines.push('### Statistics');
    lines.push(`- Total messages: ${s.totalMessages} (${s.tutorMessages} tutor, ${s.userMessages} user)`);
    lines.push(`- Concepts: ${s.conceptsTotal} (${s.conceptsMastered} mastered, ${s.conceptsLearning} learning, ${s.conceptsPending} pending)`);
    lines.push(`- Misconceptions: ${s.misconceptionsTotal} (${s.misconceptionsUnresolved} unresolved)`);
    lines.push(`- Average mastery score: ${s.avgMasteryScore}%`);
    lines.push(`- Teaching rounds: ${s.teachingRounds}`);
    lines.push(`- Diagnosis rounds: ${s.diagnosisRounds}`);
    lines.push('');

    return lines.join('\n');
  }
}
