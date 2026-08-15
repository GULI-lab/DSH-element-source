/**
 * Structural types for the cordis services this plugin consumes. A third-party
 * plugin resolves outside the DSH monorepo's single cordis instance, so the
 * upstream `declare module 'cordis'` augmentations do not reach this Context.
 * The members below mirror the actual runtime shapes this plugin touches;
 * drift from upstream is contained to this file.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context as CordisContext } from 'cordis'

/** One named webserver route (mirror of @deepseek-ai/dsh-host-webserver). */
export interface EsWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface EsWebServer {
  register(route: EsWebRoute): () => void
}

/** A published session's header slice (authoritative cwd). */
export interface EsSessionHeader {
  cwd?: string
}

/** The host session store face (`ctx.sessions.get(id)` returns the live session). */
export interface EsSessionStore {
  get(id: string): { header: EsSessionHeader } | undefined
}

/** One loader entry's options slice (the connection row's resolved config). */
export interface EsLoaderEntry {
  options: { name: string; config?: unknown }
}

/** The loader face used to read the connection row's trustedHosts config. */
export interface EsLoader {
  entries(): Iterable<EsLoaderEntry>
}

/** The live agent face (mirror of @deepseek-ai/dsh-agent's Agent). */
export interface EsAgent {
  /** Submit steering for the nearest step; an idle driver starts a turn. */
  steer(message: unknown): void
  /** Inject user-role context without starting a turn. */
  inject(message: unknown): void
}

/** The host live-agent registry face (mirror of the runtime `ctx.agents`). */
export interface EsAgentsService {
  get(id: string): EsAgent | undefined
}

/** One contributed system-prompt section (mirror of @deepseek-ai/dsh-system-prompt). */
export interface EsSystemPromptSection {
  name: string
  order: number
  text: string | (() => string)
  complete?: boolean
}

/** The systemPrompt service face. */
export interface EsSystemPromptService {
  section(definition: EsSystemPromptSection): () => void
}

/** The context type the host half compiles against (no global augmentation, so
 *  it never collides with dsh-better-sidebar's own `declare module` members in
 *  the same cordis scopes). `agents` / `systemPrompt` are read through
 *  `ctx.get()` at the call sites and narrowed there. */
export type Context = CordisContext & {
  webServer: EsWebServer
  sessions: EsSessionStore
  loader: EsLoader
  effect(fn: () => void | (() => void), label?: string): void
}
