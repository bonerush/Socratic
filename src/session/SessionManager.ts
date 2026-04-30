import { type Vault, normalizePath } from 'obsidian';
import { SESSION_DIR, type SessionState, type LearnerProfile, type SessionSummary, emptyMemoryCollection } from '../types';
import { slugify } from '../utils/common';
import { ensureDir } from '../utils/vault';
import { extractJsonFromMarkdown } from '../utils/json';
import { MemoryManager } from '../memory/MemoryManager';
import { MemoryExtractor } from '../memory/MemoryExtractor';
import { SessionExporter } from './SessionExporter';

export class SessionManager {
  private vault: Vault;
  private basePath: string;
  memoryManager: MemoryManager;
  memoryExtractor: MemoryExtractor;
  private exporter: SessionExporter;

  constructor(vault: Vault, customBasePath?: string) {
    this.vault = vault;
    this.basePath = customBasePath || SESSION_DIR;
    this.memoryManager = new MemoryManager(vault, this.basePath);
    this.memoryExtractor = new MemoryExtractor();
    this.exporter = new SessionExporter(vault);
  }

  getSessionDir(noteSlug: string): string {
    return normalizePath(`${this.basePath}/${noteSlug}`);
  }

  private getHistoryDir(noteSlug: string): string {
    return normalizePath(`${this.getSessionDir(noteSlug)}/history`);
  }

  async sessionExists(noteSlug: string): Promise<boolean> {
    const dir = this.getSessionDir(noteSlug);
    try {
      return await this.vault.adapter.exists(`${dir}/session.json`);
    } catch {
      return false;
    }
  }

  private async listFiles(dir: string): Promise<string[]> {
    try {
      const listing = await this.vault.adapter.list(dir);
      if (!listing || typeof listing !== 'object') return [];
      return Array.isArray(listing.files) ? listing.files : [];
    } catch {
      return [];
    }
  }

  private resolveFilePath(file: string, baseDir: string): string {
    return file.startsWith(baseDir) ? file : normalizePath(`${baseDir}/${file}`);
  }

  private async safeRemove(path: string): Promise<void> {
    try {
      await this.vault.adapter.remove(path);
    } catch {
      // File may not exist
    }
  }

  private buildSessionSummary(state: SessionState, sessionId: string): SessionSummary {
    return {
      noteSlug: state.noteSlug,
      noteTitle: state.noteTitle,
      sessionId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      conceptCount: state.concepts.length,
      completed: state.completed,
      messageCount: state.messages.length,
    };
  }

  async hasAnySessionHistory(noteSlug: string): Promise<boolean> {
    if (await this.sessionExists(noteSlug)) return true;
    const historyDir = this.getHistoryDir(noteSlug);
    try {
      const exists = await this.vault.adapter.exists(historyDir);
      if (!exists) return false;
      const files = await this.listFiles(historyDir);
      return files.some((f) => typeof f === 'string' && f.endsWith('.json'));
    } catch {
      return false;
    }
  }

  async loadMostRecentSession(noteSlug: string): Promise<SessionState | null> {
    const current = await this.loadSession(noteSlug);
    if (current) return current;

    const historyDir = this.getHistoryDir(noteSlug);
    try {
      const exists = await this.vault.adapter.exists(historyDir);
      if (!exists) return null;
      const files = await this.listFiles(historyDir);

      const jsonFiles = files
        .filter((f): f is string => typeof f === 'string' && f.endsWith('.json'))
        .map((f) => this.resolveFilePath(f, historyDir))
        .sort();

      if (jsonFiles.length === 0) return null;

      const mostRecent = jsonFiles[jsonFiles.length - 1]!;
      const content = await this.vault.adapter.read(mostRecent);
      return JSON.parse(content) as SessionState;
    } catch {
      return null;
    }
  }

  async loadSession(noteSlug: string, sessionId?: string): Promise<SessionState | null> {
    const dir = this.getSessionDir(noteSlug);
    try {
      let path: string;
      if (sessionId && sessionId !== 'current') {
        path = normalizePath(`${this.getHistoryDir(noteSlug)}/${sessionId}.json`);
      } else {
        path = `${dir}/session.json`;
      }
      const exists = await this.vault.adapter.exists(path);
      if (!exists) return null;
      const content = await this.vault.adapter.read(path);
      return JSON.parse(content) as SessionState;
    } catch {
      return null;
    }
  }

  async saveSession(noteSlug: string, state: SessionState): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    await ensureDir(this.vault, dir);
    const next = { ...state, updatedAt: Date.now() };
    await this.vault.adapter.write(`${dir}/session.json`, JSON.stringify(next, null, 2));
    await this.exporter.exportSessionMarkdown(dir, state);
  }

  async archiveSession(noteSlug: string): Promise<void> {
    const dir = this.getSessionDir(noteSlug);
    const sessionPath = `${dir}/session.json`;
    try {
      const exists = await this.vault.adapter.exists(sessionPath);
      if (!exists) return;
      const content = await this.vault.adapter.read(sessionPath);
      const state = JSON.parse(content) as SessionState;
      // Only archive if there are actual messages
      if (!state.messages || state.messages.length === 0) return;
      const historyDir = this.getHistoryDir(noteSlug);
      await ensureDir(this.vault, historyDir);
      const sessionId = Date.now().toString();
      await this.vault.adapter.write(
        normalizePath(`${historyDir}/${sessionId}.json`),
        JSON.stringify(state, null, 2)
      );
    } catch {
      // Silently fail archiving
    }
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

  async deleteSession(noteSlug: string, sessionId?: string): Promise<void> {
    // If sessionId provided and not 'current', delete from history
    if (sessionId && sessionId !== 'current') {
      const historyPath = normalizePath(`${this.getHistoryDir(noteSlug)}/${sessionId}.json`);
      try {
        await this.vault.adapter.remove(historyPath);
      } catch {
        // File may not exist
      }
      return;
    }

    // Otherwise delete the entire note session directory (current session + all history)
    const dir = this.getSessionDir(noteSlug);
    try {
      const exists = await this.vault.adapter.exists(dir);
      if (!exists) return;

      let files = await this.listFiles(dir);
      if (files.length === 0) {
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
        await this.safeRemove(this.resolveFilePath(file, dir));
      }

      // Also delete history folder if it exists
      try {
        const historyDir = this.getHistoryDir(noteSlug);
        const historyExists = await this.vault.adapter.exists(historyDir);
        if (historyExists) {
          const historyFiles = await this.listFiles(historyDir);
          for (const file of historyFiles) {
            if (typeof file !== 'string') continue;
            await this.safeRemove(this.resolveFilePath(file, historyDir));
          }
          await this.vault.adapter.remove(historyDir);
        }
      } catch {
        // History dir may not exist
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
        // Read current active session
        const currentSummary = await this.tryReadSessionSummary(folderName);
        if (currentSummary) summaries.push(currentSummary);

        // Read archived history sessions
        const historySummaries = await this.tryReadHistorySummaries(folderName);
        summaries.push(...historySummaries);
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
      return this.buildSessionSummary(state, 'current');
    } catch {
      return null;
    }
  }

  private async tryReadHistorySummaries(folderName: string): Promise<SessionSummary[]> {
    const historyDir = normalizePath(`${this.basePath}/${folderName}/history`);
    try {
      const exists = await this.vault.adapter.exists(historyDir);
      if (!exists) return [];

      const files = await this.listFiles(historyDir);
      const summaries: SessionSummary[] = [];

      for (const file of files) {
        if (typeof file !== 'string') continue;
        const fileName = file.replace(/\\/g, '/').split('/').pop() || '';
        if (!fileName.endsWith('.json')) continue;
        const sessionId = fileName.replace(/\.json$/, '');
        const filePath = this.resolveFilePath(file, historyDir);
        try {
          const raw = await this.vault.adapter.read(filePath);
          const state = JSON.parse(raw) as SessionState;
          summaries.push(this.buildSessionSummary(state, sessionId));
        } catch {
          // Skip unreadable files
        }
      }

      return summaries;
    } catch {
      return [];
    }
  }

  async clearCurrentSession(noteSlug: string): Promise<void> {
    const sessionPath = normalizePath(`${this.getSessionDir(noteSlug)}/session.json`);
    try {
      const exists = await this.vault.adapter.exists(sessionPath);
      if (exists) {
        await this.vault.adapter.remove(sessionPath);
      }
    } catch {
      // Ignore removal errors
    }
  }

  async loadAllSessionStates(): Promise<SessionState[]> {
    const summaries = await this.listSessions();
    const states: SessionState[] = [];
    for (const summary of summaries) {
      const state = await this.loadSession(summary.noteSlug, summary.sessionId === 'current' ? undefined : summary.sessionId);
      if (state) states.push(state);
    }
    return states;
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

}
