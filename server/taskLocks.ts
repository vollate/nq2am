export type TaskOperation = "match" | "retry" | "agent" | "create";
export type TaskLock = { operation: TaskOperation; token: string; identity: string };
const locks = new Map<string, TaskLock>();
export class TaskBusyError extends Error {
  readonly status = 409;
  constructor() {
    super("Task is busy");
  }
}
export function taskLock(key: string): TaskLock | undefined {
  return locks.get(key);
}
export function assertTaskIdle(key: string): void {
  if (locks.has(key)) throw new TaskBusyError();
}
export function acquireTask(key: string, lock: TaskLock): void {
  assertTaskIdle(key);
  locks.set(key, lock);
}
export function releaseTask(key: string, token: string): void {
  if (locks.get(key)?.token === token) locks.delete(key);
}
