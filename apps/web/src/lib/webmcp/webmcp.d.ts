/**
 * Ambient typings for the WebMCP browser API (W3C WebML CG draft).
 *
 * Kept local instead of depending on `webmcp-types` to avoid lockfile churn
 * for ~60 lines. Shape follows webmcp-types@0.1.7:
 *   https://www.npmjs.com/package/webmcp-types
 *
 * `document.modelContext` is the spec location (Chrome 149+ origin trial,
 * Edge 150+). `navigator.modelContext` is the older Chrome 146 preview
 * location and the surface polyfills such as @mcp-b/global expose; the
 * runtime feature-detects both.
 */

declare namespace WebMCP {
  type MaybePromise<T> = T | Promise<T>;

  interface ToolExecuteCallbackOptions {
    signal: AbortSignal;
  }

  type ToolExecuteCallback = (
    inputObject: Record<string, unknown>,
    options: ToolExecuteCallbackOptions,
  ) => MaybePromise<unknown>;

  interface ToolAnnotations {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
  }

  interface ModelContextTool {
    name: string;
    title?: string;
    description: string;
    inputSchema?: object;
    execute: ToolExecuteCallback;
    annotations?: ToolAnnotations;
  }

  interface ModelContextRegisterToolOptions {
    signal?: AbortSignal;
    exposedTo?: string[];
  }

  interface RegisteredTool {
    name: string;
    title: string;
    description: string;
    inputSchema?: object;
    origin: string;
    annotations?: ToolAnnotations;
  }

  interface ModelContext extends EventTarget {
    registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void>;
    /** Present on the older navigator.modelContext preview surface and on polyfills. */
    unregisterTool?(name: string): void;
    getTools?(): Promise<RegisteredTool[]>;
    ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null;
  }
}

interface Document {
  readonly modelContext?: WebMCP.ModelContext;
}

interface Navigator {
  /** Pre-spec location (Chrome 146 preview, @mcp-b/global polyfill). */
  readonly modelContext?: WebMCP.ModelContext;
}
