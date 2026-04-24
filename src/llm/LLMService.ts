import { requestUrl } from 'obsidian';
import type { SocraticPluginSettings, TutorMessage } from '../types';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
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

  async chat(
    systemPrompt: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    temperature = 0.7,
    maxTokens = 2000
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
      return {
        content: data.choices[0].message.content,
        finishReason: data.choices[0].finish_reason || 'stop',
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

  private isOpenAICompatible(): boolean {
    return this.settings.apiEndpoint.includes('openai.com') ||
           this.settings.apiEndpoint.includes('api.aiproxy.io') ||
           !this.settings.apiEndpoint.includes('anthropic.com');
  }
}
