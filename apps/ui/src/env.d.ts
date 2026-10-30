/// <reference types="vite/client" />
import type { Browser2dApi } from "@browser-2d/contracts/public";

declare global {
  interface Window {
    browser2d?: Browser2dApi;
  }
}
