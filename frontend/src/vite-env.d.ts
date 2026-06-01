/// <reference types="vite/client" />

interface Window {
  ethereum?: {
    isMetaMask?: boolean;
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    removeListener: (event: string, cb: (...args: unknown[]) => void) => void;
  };
}
