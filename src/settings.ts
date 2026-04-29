import { App, PluginSettingTab, Setting, MarkdownView } from 'obsidian';
import type SocraticNoteTutorPlugin from './main';
import { getTranslations, resolveLang } from './i18n/translations';

export class SocraticSettingTab extends PluginSettingTab {
  plugin: SocraticNoteTutorPlugin;
  private t = getTranslations('en');

  constructor(app: App, plugin: SocraticNoteTutorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.updateTranslations();

    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(this.t.settingsTitle).setHeading();

    new Setting(containerEl)
      .setName(this.t.apiEndpointLabel)
      .setDesc(this.t.apiEndpointDesc)
      .addText(text => text
        .setPlaceholder('https://api.deepseek.com/chat/completions')
        .setValue(this.plugin.settings.apiEndpoint)
        .onChange(async value => {
          this.plugin.settings.apiEndpoint = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.t.apiKeyLabel)
      .setDesc(this.t.apiKeyDesc)
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('Sk-...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async value => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(this.t.modelLabel)
      .setDesc(this.t.modelDesc)
      .addText(text => text
        .setPlaceholder('Gpt-4')
        .setValue(this.plugin.settings.model)
        .onChange(async value => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.t.disableToolCallingLabel)
      .setDesc(this.t.disableToolCallingDesc)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.disableToolCalling)
        .onChange(async value => {
          this.plugin.settings.disableToolCalling = value;
          await this.plugin.saveSettings();
        }));

    const currentLang = this.plugin.settings.language;

    new Setting(containerEl)
      .setName(this.t.langLabel)
      .setDesc(this.t.langDesc)
      .addDropdown(dropdown => dropdown
        .addOption('auto', this.t.langAuto)
        .addOption('en', this.t.langEn)
        .addOption('zh', this.t.langZh)
        .setValue(currentLang)
        .onChange(async value => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
          this.plugin.updateViewLanguage(resolveLang(value, this.getActiveNoteContent()));
          this.display();
        }));

    new Setting(containerEl)
      .setName(this.t.storagePathLabel)
      .setDesc(this.t.storagePathDesc)
      .addText(text => text
        .setPlaceholder('')
        .setValue(this.plugin.settings.sessionStoragePath)
        .onChange(async value => {
          this.plugin.settings.sessionStoragePath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.t.masteryLabel)
      .setDesc(this.t.masteryDesc)
      .addSlider(slider => slider
        .setLimits(50, 100, 5)
        .setValue(this.plugin.settings.masteryThreshold)
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.masteryThreshold = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.t.maxConceptsLabel)
      .setDesc(this.t.maxConceptsDesc)
      .addSlider(slider => slider
        .setLimits(3, 30, 1)
        .setValue(this.plugin.settings.maxConceptsPerSession)
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.maxConceptsPerSession = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.t.debugModeLabel)
      .setDesc(this.t.debugModeDesc)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async value => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
          this.plugin.updateDebugMode();
        }));

    new Setting(containerEl)
      .setName(this.t.debugPathLabel)
      .setDesc(this.t.debugPathDesc)
      .addText(text => text
        .setPlaceholder('')
        .setValue(this.plugin.settings.debugStoragePath)
        .onChange(async value => {
          this.plugin.settings.debugStoragePath = value;
          await this.plugin.saveSettings();
          this.plugin.updateDebugPath();
        }));
  }

  private updateTranslations(): void {
    this.t = getTranslations(resolveLang(this.plugin.settings.language, this.getActiveNoteContent()));
  }

  private getActiveNoteContent(): string {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.editor?.getValue() ?? '';
  }
}
