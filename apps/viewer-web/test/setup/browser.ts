import { beforeEach } from "vitest";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const localStorage = createMemoryStorage();
const sessionStorage = createMemoryStorage();

function installBrowserStorage() {
  if (typeof window === "undefined") {
    return;
  }

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: sessionStorage,
  });

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: sessionStorage,
  });
}

installBrowserStorage();

beforeEach(installBrowserStorage);
