export interface AppConfig {
  activeProvider: string;
  claudeModel: string;
}

export function defaultConfig(): AppConfig {
  return { activeProvider: "claude", claudeModel: "claude-opus-5" };
}
