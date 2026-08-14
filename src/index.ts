/**
 * dsh-element-source host half.
 *
 * Responsibilities:
 *  - Serve the page probe script at GET /dsh-element-source/inject.js (public:
 *    dev pages load it cross-origin; it is read-only code with no secrets).
 *  - Resolve one pick at POST /dsh-element-source/api/resolve (behind the
 *    same browser-trust fence as the /api gateway): normalize the reported
 *    source path, confine it to the session workspace, locate a line by text
 *    search when needed, and — when autoSteer is on — wake the session agent
 *    with a user-role message so the chat shows the source.
 *  - Contribute a system-prompt section teaching the agent how to present a
 *    located source.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { Context } from './context-types.ts'
import type { ElementPick, ResolveResult } from './protocol.ts'
import { pickFromUnknown } from './protocol.ts'
import { resolvePick, type SourceMapping } from './resolve.ts'
import { buildSteerText } from './steer.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { ApiError, readJsonBody, requireString, writeError, writeJson, writeOk } from './wire.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-element-source'

/** Hard dependencies: the webserver routes, the session store, the loader's connection row. */
export const inject = ['webServer', 'sessions', 'loader']

/** The fixed route prefix of the plugin (host and client halves agree on it). */
export const ROUTE_PREFIX = '/dsh-element-source'

/** Plugin configuration (optional; defaults are documented in the README). */
export interface ElementSourceConfig {
  /** Wake the session agent with a located-source message after a pick. Default true. */
  autoSteer?: boolean
  /** Source-path prefix mappings (e.g. monorepo / node_modules rebasing). */
  mappings?: readonly SourceMapping[]
  /** Session id pinned by configuration, ignoring the request's sessionId. */
  sessionId?: string
}

const SYSTEM_PROMPT_SECTION = [
  '当收到来源为 dsh-element-source 的「[元素定位]」用户消息时：',
  '1. 用 read 工具读取消息中给出的文件路径（如带行号则读取该文件全部内容后定位到对应行）；',
  '2. 在回复中用代码块展示定位到的源码，用一句话说明该元素渲染了什么；',
  '3. 然后停止，等待用户提出修改需求，不要擅自大改代码。',
  '',
  'When you receive an "[Element located]" user message from dsh-element-source:',
  '1. read the file path given in the message with the read tool (and find the stated line when present);',
  '2. show the located code in a code block and explain in one sentence what the element renders;',
  '3. then stop and wait for the user\'s change request — do not make large edits on your own.',
].join('\n')

/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx: Context): string[] {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') {
      const config = entry.options.config as { trustedHosts?: string[] } | undefined
      return config?.trustedHosts ?? []
    }
  }
  return []
}

/** Resolve a session's authoritative working directory (header wins, then the caller's). */
function sessionCwdOf(ctx: Context, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') return clientCwd
  return process.cwd()
}

/** The resolve request body (validated). */
interface ResolvePayload {
  sessionId: string
  cwd?: string
  pick: ElementPick
  autoSteer?: boolean
}

function parseResolvePayload(payload: unknown): ResolvePayload {
  const sessionId = requireString(payload, 'sessionId')
  const record = payload as Record<string, unknown>
  const cwd = typeof record.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
  const pick = pickFromUnknown(record.pick)
  if (pick === undefined) {
    throw new ApiError('bad-request', 'missing or invalid "pick"')
  }
  const autoSteer = typeof record.autoSteer === 'boolean' ? record.autoSteer : undefined
  return { sessionId, cwd, pick, autoSteer }
}

/**
 * Plugin body.
 * @param ctx - host plugin context (webServer, sessions, loader).
 * @param config - optional deployment-provided configuration.
 */
export function apply(ctx: Context, config?: ElementSourceConfig): void {
  const resolved: Required<Pick<ElementSourceConfig, 'autoSteer'>> & ElementSourceConfig = {
    autoSteer: config?.autoSteer ?? true,
    mappings: config?.mappings,
    sessionId: config?.sessionId,
  }
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHostsOf(ctx))

  // ── Public probe script route ───────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      if (pathname === `${ROUTE_PREFIX}/inject.js` && (req.method === 'GET' || req.method === 'HEAD')) {
        try {
          const script = await readFile(new URL('../lib/inject.js', import.meta.url))
          res.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          })
          res.end(req.method === 'HEAD' ? undefined : script)
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('dsh-element-source: inject.js not built (run pnpm build)')
        }
        return
      }
      if (pathname === `${ROUTE_PREFIX}/api/resolve`) {
        await handleResolve(ctx, resolved, fence, req, res)
        return
      }
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown route ${pathname}` } })
    },
  }), 'dsh-element-source: routes')

  // ── System-prompt section ───────────────────────────────────────────────
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'dsh-element-source',
      order: 60,
      text: SYSTEM_PROMPT_SECTION,
    }), 'dsh-element-source: system prompt section')
  }
}

/** Handle one resolve request: fence, resolve, optionally steer, respond. */
async function handleResolve(
  ctx: Context,
  config: Required<Pick<ElementSourceConfig, 'autoSteer'>> & ElementSourceConfig,
  fence: (req: IncomingMessage) => boolean,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!fence(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req)
    const body = parseResolvePayload(payload)
    const sessionId = config.sessionId ?? body.sessionId
    const cwd = sessionCwdOf(ctx, sessionId, body.cwd)
    const located = await resolvePick(body.pick, {
      cwd,
      mappings: config.mappings,
      frameworkHint: body.pick.framework,
    })

    let result: ResolveResult
    if ('error' in located) {
      result = {
        ok: false,
        method: 'none',
        framework: body.pick.framework,
        existed: false,
        steered: false,
        error: located.error,
      }
    } else {
      const steered = await maybeSteer(ctx, config.autoSteer, body, sessionId, located)
      result = {
        ok: true,
        file: located.file,
        relative: located.relative,
        line: located.line,
        column: located.column,
        snippet: located.snippet,
        method: located.method,
        framework: body.pick.framework,
        existed: located.existed,
        steered,
      }
    }
    writeOk(res, result)
  } catch (error) {
    writeError(res, error)
  }
}

/** Deliver the steering message when enabled and the session's agent is live. */
async function maybeSteer(
  ctx: Context,
  autoSteer: boolean,
  body: ResolvePayload,
  sessionId: string,
  located: { relative: string; line?: number; method: ResolveResult['method'] },
): Promise<boolean> {
  if (!autoSteer) return false
  const agents = ctx.get('agents')
  if (agents === undefined) return false
  const agent = agents.get(sessionId)
  if (agent === undefined) return false
  const message = createUserMessage({
    content: [{ type: 'text', text: buildSteerText(located, body.pick.element, body.pick.pageUrl) }],
    source: { kind: 'plugin', plugin: 'dsh-element-source' },
  })
  agent.steer(message)
  return true
}

/** Re-exported for downstream type consumers. */
export type { Context } from './context-types.ts'
export type { ElementPick, ResolveResult } from './protocol.ts'
