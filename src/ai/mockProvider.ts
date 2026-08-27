import type { AIProvider, Availability, CompletionRequest } from "./provider.js";

export class MockProvider implements AIProvider {
  readonly id = "mock";
  readonly name = "Mock（测试）";
  constructor(private handler: (req: CompletionRequest) => string) {}
  async checkAvailability(): Promise<Availability> {
    return { available: true };
  }
  async complete(req: CompletionRequest): Promise<string> {
    return this.handler(req);
  }
}
