import type { SessionState } from '../types';
import type { Vault } from 'obsidian';

/**
 * Handles markdown export of session state for human-readable archiving.
 */
export class SessionExporter {
  constructor(private vault: Vault) {}

  async exportSessionMarkdown(dir: string, state: SessionState): Promise<void> {
    const md = this.buildMarkdown(state);
    await this.vault.adapter.write(`${dir}/session.md`, md);
  }

  private buildMarkdown(state: SessionState): string {
    let md = `# Socratic Session: ${state.noteTitle}\n\n`;
    md += `- **Started**: ${new Date(state.createdAt).toISOString()}\n`;
    md += `- **Last updated**: ${new Date(state.updatedAt).toISOString()}\n`;
    md += `- **Status**: ${state.completed ? 'Completed' : 'In Progress'}\n\n`;

    md += `## Concept Progress\n\n`;
    md += `| Concept | Status | Mastery | Last Review |\n`;
    md += `|---------|--------|---------|-------------|\n`;
    for (const concept of state.concepts) {
      const timeStr = concept.lastReviewTime
        ? new Date(concept.lastReviewTime).toLocaleDateString()
        : '-';
      md += `| ${concept.name} | ${concept.status} | ${concept.masteryScore}% | ${timeStr} |\n`;
    }

    if (state.misconceptions.length > 0) {
      md += `\n## Misconceptions\n\n`;
      md += `| Misconception | Root Cause | Resolved |\n`;
      md += `|--------------|------------|----------|\n`;
      for (const m of state.misconceptions) {
        md += `| ${m.misconception} | ${m.inferredRootCause} | ${m.resolved ? 'Yes' : 'No'} |\n`;
      }
    }

    md += `\n## Conversation Log\n\n`;
    for (const msg of state.messages) {
      const prefix = msg.role === 'tutor' ? '**Tutor**:' : '**You**:';
      md += `> ${prefix} ${msg.content}\n\n`;
    }

    return md;
  }
}
