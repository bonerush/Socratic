import { type Vault, type TFile, normalizePath } from 'obsidian';
import { SESSION_DIR, type SessionState, type LearnerProfile, type ConceptState, type MisconceptionRecord } from '../types';
import { generateId, slugify } from '../utils/helpers';

export class SessionManager {
  private vault: Vault;
  private basePath: string;

  constructor(vault: Vault, customBasePath?: string) {
    this.vault = vault;
    this.basePath = customBasePath || SESSION_DIR;
  }

  getSessionDir(noteSlug: string): string {
    return normalizePath(`${this.basePath}/${noteSlug}`);
  }

  async sessionExists(noteSlug: string): Promise<boolean> {
    const dir = this.getSessionDir(noteSlug);
    try {
      return await this.vault.adapter.exists(`${dir}/session.md`);
    } catch {
      return false;
    }
  }

  async loadSession(noteSlug: string): Promise<SessionState | null> {
    const dir = this.getSessionDir(noteSlug);
    try {
      const exists = await this.vault.adapter.exists(`${dir}/session.json`);
      if (!exists) return null;
      const content = await this.vault.adapter.read(`${dir}/session.json`);
      return JSON.parse(content) as SessionState;
    } catch {
      return null;
    }
  }

  async saveSession(noteSlug: string, state: SessionState): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    await this.ensureDir(dir);
    state.updatedAt = Date.now();
    await this.vault.adapter.write(`${dir}/session.json`, JSON.stringify(state, null, 2));
    await this.writeSessionMarkdown(dir, state);
  }

  async loadLearnerProfile(): Promise<LearnerProfile | null> {
    const path = normalizePath(`${this.basePath}/learner-profile.md`);
    try {
      const exists = await this.vault.adapter.exists(path);
      if (!exists) return null;
      const content = await this.vault.adapter.read(path);
      return JSON.parse(this.extractJsonFromMarkdown(content)) as LearnerProfile;
    } catch {
      return null;
    }
  }

  async saveLearnerProfile(profile: LearnerProfile): Promise<void> {
    const path = normalizePath(`${this.basePath}/learner-profile.md`);
    await this.ensureDir(this.basePath);
    const content = `# Learner Profile\n\nLast updated: ${new Date(profile.lastUpdated).toISOString()}\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`;
    await this.vault.adapter.write(path, content);
  }

  async conceptMapExists(noteSlug: string, index: number): Promise<boolean> {
    const dir = `${this.getSessionDir(noteSlug)}/concept-map`;
    try {
      return await this.vault.adapter.exists(`${dir}/concept-map-${index}.html`);
    } catch {
      return false;
    }
  }

  async saveConceptMap(noteSlug: string, index: number, html: string): Promise<void> {
    const dir = `${this.getSessionDir(noteSlug)}/concept-map`;
    await this.ensureDir(dir);
    await this.vault.adapter.write(`${dir}/concept-map-${index}.html`, html);
  }

  async saveRoadmap(noteSlug: string, html: string): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    await this.ensureDir(dir);
    await this.vault.adapter.write(`${dir}/roadmap.html`, html);
  }

  async saveSummary(noteSlug: string, html: string, isFinal: boolean): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    await this.ensureDir(dir);
    const filename = isFinal ? 'summary-final.html' : 'summary.html';
    await this.vault.adapter.write(`${dir}/${filename}`, html);
  }

  async saveVisual(noteSlug: string, name: string, content: string): Promise<void> {
    const dir = `${this.getSessionDir(noteSlug)}/visuals`;
    await this.ensureDir(dir);
    await this.vault.adapter.write(`${dir}/${name}`, content);
  }

  async deleteSession(noteSlug: string): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    try {
      await this.vault.adapter.remove(dir);
    } catch {
      // Directory may not exist
    }
  }

  createNewSession(noteTitle: string, noteContent: string): SessionState {
    const now = Date.now();
    return {
      noteTitle,
      noteSlug: slugify(noteTitle),
      noteContent,
      createdAt: now,
      updatedAt: now,
      currentConceptId: null,
      concepts: [],
      conceptOrder: [],
      misconceptions: [],
      messages: [],
      completed: false,
    };
  }

  private async ensureDir(dir: string): Promise<void> {
    const adapter = this.vault.adapter;
    const exists = await adapter.exists(dir);
    if (!exists) {
      await adapter.mkdir(normalizePath(dir));
    }
  }

  private async writeSessionMarkdown(dir: string, state: SessionState): Promise<void> {
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

    await this.vault.adapter.write(`${dir}/session.md`, md);
  }

  private extractJsonFromMarkdown(content: string): string {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    return jsonMatch ? jsonMatch[1]! : content;
  }
}
