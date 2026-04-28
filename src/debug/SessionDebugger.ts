import type { SessionState, ConceptState } from '../types';

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

    // 1. Message sequence check: no two consecutive tutor questions without a user message between
    const nonSystemMessages = state.messages.filter((m) => m.type !== 'system');
    for (let i = 1; i < nonSystemMessages.length; i++) {
      const prev = nonSystemMessages[i - 1]!;
      const curr = nonSystemMessages[i]!;
      if (prev.role === 'tutor' && curr.role === 'tutor') {
        // Allow initial diagnosis (first tutor message)
        const prevIndex = state.messages.findIndex((m) => m.id === prev.id);
        if (prevIndex > 0) {
          issues.push(`Consecutive tutor messages without user response: ${prev.id} -> ${curr.id}`);
        }
      }
    }

    // 2. Mastery check completeness
    for (let i = 0; i < state.messages.length; i++) {
      const msg = state.messages[i]!;
      if (
        msg.role === 'tutor' &&
        msg.type === 'feedback' &&
        msg.question?.isMasteryCheck
      ) {
        const subsequentMessages = state.messages.slice(i + 1);
        const statusChange = subsequentMessages.find(
          (m) =>
            m.role === 'tutor' &&
            m.type === 'feedback' &&
            (m.content.includes('mastered') || m.content.includes('learning') || m.content.includes('已掌握') || m.content.includes('学习中'))
        );
        if (!statusChange) {
          issues.push(`Mastery check message ${msg.id} is not followed by a concept status change to mastered/learning`);
        }
      }
    }

    // 3. Concept dependency cycle detection
    const dependencyCycles = this.findDependencyCycles(state.concepts);
    for (const cycle of dependencyCycles) {
      issues.push(`Concept dependency cycle detected: ${cycle.join(' -> ')}`);
    }

    // 4. Orphaned user messages: user messages without a preceding tutor question
    for (let i = 0; i < state.messages.length; i++) {
      const msg = state.messages[i]!;
      if (msg.role === 'user') {
        const precedingTutor = state.messages
          .slice(0, i)
          .reverse()
          .find((m) => m.role === 'tutor' && m.type === 'question');
        if (!precedingTutor) {
          issues.push(`Orphaned user message ${msg.id}: no preceding tutor question`);
        }
      }
    }

    // 5. Empty content check
    const emptyTutorMessages = state.messages.filter(
      (m) => m.role === 'tutor' && (!m.content.trim() || m.content.trim() === '...')
    );
    if (emptyTutorMessages.length > 0) {
      issues.push(`Empty or placeholder tutor messages: ${emptyTutorMessages.length} (ids: ${emptyTutorMessages.map((m) => m.id).join(', ')})`);
    }

    const stats = this.computeStats(state);

    return {
      healthy: issues.length === 0,
      issues,
      stats,
    };
  }

  private findDependencyCycles(concepts: ConceptState[]): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const adjacency = new Map<string, string[]>();
    for (const c of concepts) {
      adjacency.set(c.id, c.dependencies);
    }

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = adjacency.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (!adjacency.has(neighbor)) continue;
        if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        } else if (recursionStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart);
          cycle.push(neighbor);
          cycles.push(cycle);
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const c of concepts) {
      if (!visited.has(c.id)) {
        dfs(c.id, []);
      }
    }

    return cycles;
  }

  computeStats(state: SessionState): SessionStats {
    const tutorMsgs = state.messages.filter((m) => m.role === 'tutor');
    const userMsgs = state.messages.filter((m) => m.role === 'user');
    const mastered = state.concepts.filter((c) => c.status === 'mastered');
    const learning = state.concepts.filter((c) => c.status === 'learning');
    const pending = state.concepts.filter((c) => c.status === 'pending');

    const masterySum = state.concepts.reduce((sum, c) => sum + c.masteryScore, 0);

    const diagnosisRounds = tutorMsgs.filter(
      (m) => m.type === 'question' && !m.question?.conceptId
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
   * Compute a 0-100 health score for the session.
   * Higher is better. Deducts for unresolved issues, low mastery,
   * and structural imbalances.
   */
  computeHealthScore(state: SessionState): number {
    const stats = this.computeStats(state);
    let score = 100;

    score -= stats.misconceptionsUnresolved * 5;
    if (stats.avgMasteryScore < 50) score -= 10;

    const msgRatio = stats.userMessages / Math.max(1, stats.tutorMessages);
    if (msgRatio < 0.5) score -= 10;
    if (msgRatio > 2.0) score -= 5;

    if (stats.conceptsTotal === 0 && stats.totalMessages > 5) score -= 15;
    if (stats.conceptsPending === stats.conceptsTotal && stats.teachingRounds > 0) score -= 5;

    const emptyMsgs = state.messages.filter(
      (m) => m.role === 'tutor' && (!m.content.trim() || m.content.trim() === '...')
    ).length;
    score -= emptyMsgs * 5;

    return Math.max(0, Math.min(100, score));
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
