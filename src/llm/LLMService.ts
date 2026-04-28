import { requestUrl } from 'obsidian';
import type { SocraticPluginSettings } from '../types';
import type { ToolDefinition, ToolCall } from './tools';
import type { Tracer } from '../debug/Tracer';

interface OpenAIChoice {
  message?: {
    content?: string;
    tool_calls?: Array<{
      id: string;
      type?: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class LLMService {
  private settings: SocraticPluginSettings;
  private tracer: Tracer | null = null;
  private sessionSlug = 'unknown';

  constructor(settings: SocraticPluginSettings) {
    this.settings = settings;
  }

  updateSettings(settings: SocraticPluginSettings): void {
    this.settings = settings;
  }

  setTracer(tracer: Tracer | null): void {
    this.tracer = tracer;
  }

  setSessionSlug(slug: string): void {
    this.sessionSlug = slug;
  }

  /**
   * Chat using pre-assembled system prompt string.
   * Prefer `chatWithBlocks` for new code — it keeps prompt construction declarative.
   */
  async chat(
    systemPrompt: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    temperature = 0.7,
    maxTokens = 2000,
    tools?: ToolDefinition[],
    jsonMode = false,
  ): Promise<LLMResponse> {
    if (!this.settings.apiKey) {
      throw new Error('API key not configured. Please set it in plugin settings.');
    }

    const body: Record<string, unknown> = {
      model: this.settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature,
      max_tokens: maxTokens,
    };

    // Include tool definitions if provided and the API supports them
    if (tools && this.supportsToolCalling()) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }

    // Force JSON output when jsonMode is enabled (OpenAI-compatible APIs).
    // IMPORTANT: Do NOT combine jsonMode with tool calling. OpenAI and most
    // compatible providers reject or mishandle response_format + tools together.
    // Tool arguments are already JSON, so jsonMode is redundant and can cause
    // the model to return empty content with no tool calls.
    if (jsonMode && !tools) {
      body['response_format'] = { type: 'json_object' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.isOpenAICompatible()) {
      headers['Authorization'] = `Bearer ${this.settings.apiKey}`;
    }

    this.tracer?.llmRequest(
      this.sessionSlug,
      systemPrompt,
      messages,
      temperature,
      maxTokens,
      tools,
      jsonMode,
    );

    try {
      const response = await requestUrl({
        url: this.settings.apiEndpoint,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        throw: true,
      });

      const data = response.json as OpenAIResponse;
      const choice = data.choices[0];
      if (!choice) {
        throw new Error('LLM API returned empty choices array');
      }

      // Handle tool_calls response (OpenAI function calling)
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        const result: LLMResponse = {
          content: choice.message.content || '',
          toolCalls: choice.message.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
          finishReason: choice.finish_reason || 'tool_calls',
          usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              }
            : undefined,
        };
        this.tracer?.llmResponse(this.sessionSlug, result);
        return result;
      }

      // Standard content response
      const result: LLMResponse = {
        content: choice.message?.content || '',
        finishReason: choice.finish_reason || 'stop',
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };
      this.tracer?.llmResponse(this.sessionSlug, result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.tracer?.llmError(this.sessionSlug, err);
      throw new Error(`LLM API request failed: ${err.message}`);
    }
  }

  private supportsToolCalling(): boolean {
    return !this.settings.disableToolCalling && this.isOpenAICompatible();
  }

  private isOpenAICompatible(): boolean {
    return (
      this.settings.apiEndpoint.includes('openai.com') ||
      this.settings.apiEndpoint.includes('api.aiproxy.io') ||
      !this.settings.apiEndpoint.includes('anthropic.com')
    );
  }
}
