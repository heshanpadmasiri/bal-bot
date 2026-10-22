// Curated on 2026-10-22 using the providers' official model catalogs:
// https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/models/overview
// The first available entry is the default for that provider.
const selectedModels = {
  openai: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'],
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
};

export function getSelectedModels(models, provider) {
  const available = new Map(models.getModels(provider).map(model => [model.id, model]));
  return (selectedModels[provider] ?? []).flatMap(id => available.has(id) ? [available.get(id)] : []);
}
