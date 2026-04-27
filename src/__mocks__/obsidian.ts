// Minimal mock for obsidian module so tests can import LLMService and others.
export const requestUrl = async (_req: unknown) => ({ json: {} });
export const Notice = class {};
export const Plugin = class {};
export const PluginSettingTab = class {};
export const Setting = class {};
export const ItemView = class {};
export const WorkspaceLeaf = class {};
export const MarkdownView = class {};
export const TFile = class {};
export const Component = class {};
export const Platform = {};
