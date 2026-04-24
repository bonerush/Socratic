import { App, PluginSettingTab, Setting } from 'obsidian';
import type SocraticNoteTutorPlugin from './main';
import { DEFAULT_SETTINGS, type SocraticPluginSettings } from './types';

export { DEFAULT_SETTINGS };
export type { SocraticPluginSettings };

export class SocraticSettingTab extends PluginSettingTab {
  plugin: SocraticNoteTutorPlugin;

  constructor(app: App, plugin: SocraticNoteTutorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Socratic Note Tutor Settings' });

    new Setting(containerEl)
      .setName('API endpoint')
      .setDesc('The API endpoint for the LLM service (e.g. OpenAI, Anthropic, or local LLM).')
      .addText(text => text
        .setPlaceholder('https://api.openai.com/v1/chat/completions')
        .setValue(this.plugin.settings.apiEndpoint)
        .onChange(async value => {
          this.plugin.settings.apiEndpoint = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API key')
      .setDesc('Your API key for the LLM service.')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async value => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Model')
      .setDesc('The model to use for tutoring.')
      .addText(text => text
        .setPlaceholder('gpt-4')
        .setValue(this.plugin.settings.model)
        .onChange(async value => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Language preference')
      .setDesc("Preferred language for tutoring. 'auto' follows the user's note language.")
      .addText(text => text
        .setPlaceholder('auto')
        .setValue(this.plugin.settings.language)
        .onChange(async value => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Session storage path')
      .setDesc('Custom path for storing session data. Leave empty to use vault root.')
      .addText(text => text
        .setPlaceholder('')
        .setValue(this.plugin.settings.sessionStoragePath)
        .onChange(async value => {
          this.plugin.settings.sessionStoragePath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Mastery threshold')
      .setDesc('Minimum score (0-100) required to mark a concept as mastered.')
      .addSlider(slider => slider
        .setLimits(50, 100, 5)
        .setValue(this.plugin.settings.masteryThreshold)
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.masteryThreshold = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max concepts per session')
      .setDesc('Maximum number of concepts to extract from a single note.')
      .addSlider(slider => slider
        .setLimits(3, 30, 1)
        .setValue(this.plugin.settings.maxConceptsPerSession)
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.maxConceptsPerSession = value;
          await this.plugin.saveSettings();
        }));
  }
}
