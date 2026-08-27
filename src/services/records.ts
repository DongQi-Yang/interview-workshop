export interface AppRecord {
  id: string;
  type: "polish" | "plan";
  createdAt: string;
  input: unknown;
  result: unknown;
}
