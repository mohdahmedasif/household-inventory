import { AsyncLocalStorage } from "node:async_hooks";

// Who is making the current request, so the history can record it without
// every function having to pass a name along.
const store = new AsyncLocalStorage();

export function runAs(name, fn) {
  return store.run({ name }, fn);
}

export function currentActor() {
  return store.getStore()?.name ?? "";
}
