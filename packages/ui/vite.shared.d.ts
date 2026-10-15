import type { UserConfig } from "vite";

/** The repository root's Zod, by the file its `import` condition names. */
export declare function zodEntry(): string;

/** The partial Vite config both apps merge under their own (see vite.shared.js). */
export declare function sharedVite(): UserConfig;
