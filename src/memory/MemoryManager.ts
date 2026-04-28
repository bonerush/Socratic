import { type Vault, normalizePath } from 'obsidian';
import type { Memory } from '../types';
import { ensureDir } from '../utils/vault';
import { sanitizeFilename } from '../utils/common';

/**
 * Persists session memories as Markdown files under the configured
 * memory directory.
 */
export class MemoryManager {
  private vault: Vault;
  private basePath: string;

  constructor(vault: Vault, basePath: string) {
    this.vault = vault;
    this.basePath = basePath;
  }

  /** Add or update a memory. Persists to disk. */
  async save(memory: Memory): Promise<void> {
    const dir = normalizePath(`${this.basePath}/.memories/${memory.type}`);
    await ensureDir(this.vault, dir);

    const path = normalizePath(`${dir}/${sanitizeFilename(memory.name)}.md`);
    const content = this.serialize(memory);
    await this.vault.adapter.write(path, content);
  }

  private serialize(memory: Memory): string {
    const lines = [
      '---',
      `name: "${memory.name}"`,
      `type: ${memory.type}`,
      `updated: ${new Date(memory.updatedAt).toISOString()}`,
      '---',
      '',
      memory.content,
    ];
    return lines.join('\n');
  }
}
