export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface Availability {
  available: boolean;
  reason?: string;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  checkAvailability(): Promise<Availability>;
  complete(req: CompletionRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}
