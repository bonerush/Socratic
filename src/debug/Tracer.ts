import type { Vault } from 'obsidian';
import type { ToolCall } from '../llm/tools';

export type TraceEventType =
  | 'phase-start'
  | 'phase-end'
  | 'llm-request'
  | 'llm-response'
  | 'llm-error'
  | 'llm-retry'
  | 'tool-call'
  | 'parsed-result'
  | 'user-input'
  | 'healing-attempt'
  | 'self-correction'
  | 'session-start'
  | 'session-end'
  | 'engine-step'
  | 'timer-start'
  | 'timer-end'
  | 'session-summary';

export interface TraceEvent {
  id: string;
  timestamp: number;
  sessionSlug: string;
  type: TraceEventType;
  phase?: string;
  step?: string;
  data: Record<string, unknown>;
}

export interface TracerOptions {
  vault: Vault;
  enabled: boolean;
  storagePath: string;
}

function generateTraceId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): number {
  return Date.now();
}

/**
 * Tracer records structured debug/trace events for a Socratic dialogue session.
 * When disabled, all methods are no-ops for zero overhead.
 *
 * Events are persisted as JSON Lines (.jsonl) files in the vault under
 * the configured debug storage path.
 */
export class Tracer {
  private vault: Vault;
  private enabled: boolean;
  private storagePath: string;
  private buffer: TraceEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentFilePath: string | null = null;
  private activeTimers = new Map<string, number>();

  constructor(options: TracerOptions) {
    this.vault = options.vault;
    this.enabled = options.enabled;
    this.storagePath = options.storagePath || '.socratic-sessions/debug';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  updateStoragePath(path: string): void {
    this.storagePath = path;
  }

  private ensureFilePath(sessionSlug: string): string {
    if (!this.currentFilePath) {
      const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      this.currentFilePath = `${this.storagePath}/${sessionSlug}-${date}.jsonl`;
    }
    return this.currentFilePath;
  }

  private push(event: TraceEvent): void {
    if (!this.enabled) return;
    this.buffer.push(event);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), 500);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);
    if (events.length === 0) return;

    const filePath = this.ensureFilePath(events[0]!.sessionSlug);
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';

    try {
      const adapter = this.vault.adapter;
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!(await adapter.exists(dir))) {
        await adapter.mkdir(dir);
      }
      if (await adapter.exists(filePath)) {
        const existing = await adapter.read(filePath);
        await adapter.write(filePath, existing + lines);
      } else {
        await adapter.write(filePath, lines);
      }
    } catch {
      // Silent fail — tracing must never break the main flow
    }
  }

  async forceFlush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  // ── Session lifecycle ───────────────────────────────────────

  startSession(sessionSlug: string, noteTitle: string, noteContent: string): void {
    this.currentFilePath = null;
    this.activeTimers.clear();
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'session-start',
      data: { noteTitle, noteContentLength: noteContent.length },
    });
  }

  endSession(sessionSlug: string): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'session-end',
      data: {},
    });
    void this.forceFlush();
  }

  sessionSummary(
    sessionSlug: string,
    data: {
      conceptCount: number;
      masteredCount: number;
      messageCount: number;
      durationMs: number;
    },
  ): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'session-summary',
      data,
    });
  }

  // ── Engine steps ────────────────────────────────────────────

  engineStep(sessionSlug: string, step: string, input?: Record<string, unknown>): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'engine-step',
      step,
      data: input ?? {},
    });
  }

  phaseStart(sessionSlug: string, phase: string): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'phase-start',
      phase,
      data: {},
    });
  }

  phaseEnd(sessionSlug: string, phase: string): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'phase-end',
      phase,
      data: {},
    });
  }

  // ── Performance timers ──────────────────────────────────────

  timerStart(sessionSlug: string, label: string): void {
    const key = `${sessionSlug}:${label}`;
    this.activeTimers.set(key, now());
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'timer-start',
      data: { label },
    });
  }

  timerEnd(sessionSlug: string, label: string): number {
    const key = `${sessionSlug}:${label}`;
    const start = this.activeTimers.get(key);
    const duration = start ? now() - start : 0;
    this.activeTimers.delete(key);
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'timer-end',
      data: { label, durationMs: duration },
    });
    return duration;
  }

  // ── LLM calls ───────────────────────────────────────────────

  llmRequest(
    sessionSlug: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    temperature: number,
    maxTokens: number,
    tools?: unknown[],
    jsonMode?: boolean,
  ): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'llm-request',
      data: {
        systemPromptLength: systemPrompt.length,
        systemPrompt: systemPrompt.slice(0, 20000),
        messages: messages.map(m => ({ role: m.role, contentLength: m.content.length, content: m.content.slice(0, 5000) })),
        temperature,
        maxTokens,
        toolCount: tools?.length ?? 0,
        jsonMode: jsonMode ?? false,
      },
    });
  }

  llmResponse(
    sessionSlug: string,
    response: {
      content: string;
      toolCalls?: ToolCall[];
      finishReason: string;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    },
  ): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'llm-response',
      data: {
        contentLength: response.content.length,
        content: response.content.slice(0, 10000),
        toolCalls: response.toolCalls ?? [],
        finishReason: response.finishReason,
        usage: response.usage,
      },
    });
  }

  llmError(sessionSlug: string, error: Error, attempt?: number): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'llm-error',
      data: { message: error.message, attempt: attempt ?? 0 },
    });
  }

  llmRetry(sessionSlug: string, attempt: number, reason: string): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'llm-retry',
      data: { attempt, reason },
    });
  }

  // ── Parsing & results ───────────────────────────────────────

  toolCall(sessionSlug: string, toolCall: ToolCall): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'tool-call',
      data: { toolCall },
    });
  }

  parsedResult(sessionSlug: string, result: Record<string, unknown>): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'parsed-result',
      data: { result },
    });
  }

  // ── Healing & correction ────────────────────────────────────

  healingAttempt(sessionSlug: string, reason: string, correctionPrompt: string): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'healing-attempt',
      data: { reason, correctionPrompt: correctionPrompt.slice(0, 2000) },
    });
  }

  selfCorrection(sessionSlug: string, attempt: number, issue: string, correction: string): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'self-correction',
      data: { attempt, issue, correction: correction.slice(0, 2000) },
    });
  }

  // ── User input ──────────────────────────────────────────────

  userInput(sessionSlug: string, type: 'answer' | 'choice-result', content: string): void {
    this.push({
      id: generateTraceId(),
      timestamp: now(),
      sessionSlug,
      type: 'user-input',
      data: { inputType: type, content: content.slice(0, 5000) },
    });
  }

  // ── Trace file helpers ──────────────────────────────────────

  getLatestTraceFilePath(): string | null {
    return this.currentFilePath;
  }

  async listTraceFiles(): Promise<string[]> {
    try {
      const adapter = this.vault.adapter;
      if (!(await adapter.exists(this.storagePath))) return [];
      const listing = await adapter.list(this.storagePath);
      if (!listing || typeof listing !== 'object' || !Array.isArray(listing.files)) return [];
      return listing.files.filter((f) => typeof f === 'string' && f.endsWith('.jsonl'));
    } catch {
      return [];
    }
  }
}
