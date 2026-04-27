import { type Vault, normalizePath } from 'obsidian';
import { SESSION_DIR, type SessionState, type LearnerProfile, type SessionSummary, emptyMemoryCollection } from '../types';
import { slugify } from '../utils/helpers';
import { ensureDir } from '../utils/vault';
import { extractJsonFromMarkdown } from '../utils/json';
import { MemoryManager } from '../memory/MemoryManager';
import { MemoryExtractor } from '../memory/MemoryExtractor';

export class SessionManager {
  private vault: Vault;
  private basePath: string;
  memoryManager: MemoryManager;
  memoryExtractor: MemoryExtractor;

  constructor(vault: Vault, customBasePath?: string) {
    this.vault = vault;
    this.basePath = customBasePath || SESSION_DIR;
    this.memoryManager = new MemoryManager(vault, this.basePath);
    this.memoryExtractor = new MemoryExtractor();
  }

  getSessionDir(noteSlug: string): string {
    return normalizePath(`${this.basePath}/${noteSlug}`);
  }

  async sessionExists(noteSlug: string): Promise<boolean> {
    const dir = this.getSessionDir(noteSlug);
    try {
      return await this.vault.adapter.exists(`${dir}/session.json`);
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
    await ensureDir(this.vault, dir);
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
      const profile = JSON.parse(extractJsonFromMarkdown(content)) as LearnerProfile;
      // Ensure new fields exist on legacy profiles
      if (!profile.memories) profile.memories = emptyMemoryCollection();
      if (!profile.preferredConcepts) profile.preferredConcepts = [];
      if (!profile.strugglingConcepts) profile.strugglingConcepts = [];
      return profile;
    } catch {
      return null;
    }
  }

  async saveLearnerProfile(profile: LearnerProfile): Promise<void> {
    const path = normalizePath(`${this.basePath}/learner-profile.md`);
    await ensureDir(this.vault, this.basePath);
    const content = `# Learner Profile\n\nLast updated: ${new Date(profile.lastUpdated).toISOString()}\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`;
    await this.vault.adapter.write(path, content);
  }

  async saveRoadmap(noteSlug: string, html: string): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    await ensureDir(this.vault, dir);
    await this.vault.adapter.write(`${dir}/roadmap.html`, html);
  }

  async saveSummary(noteSlug: string, html: string, isFinal: boolean): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    await ensureDir(this.vault, dir);
    const filename = isFinal ? 'summary-final.html' : 'summary.html';
    await this.vault.adapter.write(`${dir}/${filename}`, html);
  }

  async deleteSession(noteSlug: string): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    try {
      // Obsidian's remove() cannot delete non-empty directories, so we must
      // delete each file individually before removing the directory.
      const exists = await this.vault.adapter.exists(dir);
      if (!exists) return;

      let files: string[] = [];
      try {
        const listing = await this.vault.adapter.list(dir);
        if (listing && typeof listing === 'object') {
          files = Array.isArray(listing.files) ? listing.files : [];
        }
      } catch {
        // list() may fail; fall back to known file names
        files = [
          `${dir}/session.json`,
          `${dir}/session.md`,
          `${dir}/roadmap.html`,
          `${dir}/summary.html`,
          `${dir}/summary-final.html`,
        ];
      }

      for (const file of files) {
        if (typeof file !== 'string') continue;
        const filePath = file.startsWith(dir) ? file : normalizePath(`${dir}/${file}`);
        try {
          await this.vault.adapter.remove(filePath);
        } catch {
          // File may not exist
        }
      }

      await this.vault.adapter.remove(dir);
    } catch {
      // Directory may not exist
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const adapter = this.vault.adapter;
    try {
      const exists = await adapter.exists(this.basePath);
      if (!exists) return [];

      let folderNames: string[] = [];
      let fileNames: string[] = [];
      try {
        const listing = await adapter.list(this.basePath);
        if (listing && typeof listing === 'object') {
          folderNames = Array.isArray(listing.folders) ? listing.folders : [];
          fileNames = Array.isArray(listing.files) ? listing.files : [];
        }
      } catch {
        return [];
      }

      const basePrefix = this.basePath.endsWith('/') ? this.basePath : this.basePath + '/';
      const candidates = new Set<string>();

      for (const folder of folderNames) {
        if (typeof folder !== 'string') continue;
        let name = folder.replace(/\/$/, '');
        if (name.startsWith(basePrefix)) name = name.slice(basePrefix.length);
        if (name && !name.startsWith('.')) candidates.add(name);
      }

      // Fallback: infer folders from nested file paths when list() returns no folders
      if (candidates.size === 0 && fileNames.length > 0) {
        for (const file of fileNames) {
          if (typeof file !== 'string') continue;
          const slashIdx = file.indexOf('/');
          if (slashIdx <= 0) continue;
          let name = file.slice(0, slashIdx);
          if (name.startsWith(basePrefix)) name = name.slice(basePrefix.length);
          if (name && !name.startsWith('.')) candidates.add(name);
        }
      }

      const summaries: SessionSummary[] = [];
      for (const folderName of candidates) {
        const summary = await this.tryReadSessionSummary(folderName);
        if (summary) summaries.push(summary);
      }

      return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  private async tryReadSessionSummary(folderName: string): Promise<SessionSummary | null> {
    const sessionPath = normalizePath(`${this.basePath}/${folderName}/session.json`);
    if (!(await this.vault.adapter.exists(sessionPath))) return null;
    try {
      const raw = await this.vault.adapter.read(sessionPath);
      const state = JSON.parse(raw) as SessionState;
      return {
        noteSlug: state.noteSlug,
        noteTitle: state.noteTitle,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        conceptCount: state.concepts.length,
        completed: state.completed,
        messageCount: state.messages.length,
      };
    } catch {
      return null;
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
}
