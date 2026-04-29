import { type Vault, normalizePath } from 'obsidian';

/**
 * Vault filesystem utilities shared across SessionManager and MemoryManager.
 */

/**
 * Ensure a directory exists in the vault, creating it if necessary.
 */
export async function ensureDir(vault: Vault, dir: string): Promise<void> {
	const adapter = vault.adapter;
	const normalized = normalizePath(dir);
	const exists = await adapter.exists(normalized);
	if (!exists) {
		await adapter.mkdir(normalized);
	}
}

