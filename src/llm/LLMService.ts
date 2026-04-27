import { requestUrl } from 'obsidian';
import type { SocraticPluginSettings } from '../types';
import type { ToolDefinition, ToolCall } from './tools';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCall[];
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

  constructor(settings: SocraticPluginSettings) {
    this.settings = settings;
  }

  updateSettings(settings: SocraticPluginSettings): void {
    this.settings = settings;
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

    // Force JSON output when jsonMode is enabled (OpenAI-compatible APIs)
    if (jsonMode) {
      body['response_format'] = { type: 'json_object' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.isOpenAICompatible()) {
      headers['Authorization'] = `Bearer ${this.settings.apiKey}`;
    }

    try {
      const response = await requestUrl({
        url: this.settings.apiEndpoint,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        throw: true,
      });

      const data = response.json;
      const choice = data.choices[0];

      // Handle tool_calls response (OpenAI function calling)
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        return {
          content: choice.message.content || '',
          toolCalls: choice.message.tool_calls.map((tc: {
            id: string;
            type?: string;
            function: { name: string; arguments: string };
          }) => ({
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
      }

      // Standard content response
      return {
        content: choice.message.content || '',
        finishReason: choice.finish_reason || 'stop',
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`LLM API request failed: ${msg}`);
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
