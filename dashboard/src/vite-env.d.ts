/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" forces the in-browser demo backend (used by static deploys). */
  readonly VITE_DEMO_MODE?: string;
  /** Control-plane base URL override for dev/production wiring. */
  readonly VITE_CONTROL_URL?: string;
}

