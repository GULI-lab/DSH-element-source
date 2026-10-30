/**
 * dsh-element-source host half.
 *
 * Responsibilities:
 *  - Serve the page probe script at GET /dsh-element-source/inject.js (public:
 *    dev pages load it cross-origin; it is read-only code with no secrets).
 *  - Queue picks at POST /dsh-element-source/api/pick. The DSH built-in
 *    browser hosts the dev page in an isolated frame, so the probe reaches
 *    this route over HTTP; the route is public and write-only (a bounded
 *    queue, no response data).
 *  - Resolve queued picks at GET /dsh-element-source/api/pending, behind the
 *    browser-trust fence: the DSH chat client polls with its session, the host
 *    resolves each pick inside the session workspace, and the client fills the
 *    composer draft. When autoSteer is on the session agent is woken too.
 *  - Contribute a system-prompt section teaching the agent how to present a
 *    located source.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { Context, EsAgentsService, EsSystemPromptService } from './context-types.ts'
import type { ElementPick, PendingResult } from './protocol.ts'
import { pickFromUnknown } from './protocol.ts'
import { resolvePick, type LocatedSource, type SourceMapping } from './resolve.ts'
import { buildSteerText } from './steer.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { ApiError, readJsonBody, writeJson } from './wire.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-element-source'

/** Hard dependencies: the webserver routes, the session store, the loader's connection row. */
export const inject = ['webServer', 'sessions', 'loader']

/** The fixed route prefix of the plugin (host and client halves agree on it). */
const ROUTE_PREFIX = '/dsh-element-source'

/** Plugin configuration (optional; defaults are documented in the README). */
interface ElementSourceConfig {
  /**
   * Wake the session agent with a located-source message after a pick.
   * Default false: a pick only fills the chat composer draft; nothing is
   * sent until the user sends it themselves.
   */
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

/** CORS headers for the two public probe routes (a dev page fetches them cross-origin). */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

/** Write a JSON response with CORS headers (public routes only). */
function writeCorsJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Bounded FIFO of picks waiting for the chat client's next poll. */
class PickQueue {
  private readonly items: Array<{ seq: number; pick: ElementPick }> = []

  private seq = 0

  /** Maximum queued picks; the oldest drop first (the newest picks matter). */
  private readonly limit = 32

  /** Append one pick; returns its queue sequence. */
  push(pick: ElementPick): number {
    this.seq += 1
    this.items.push({ seq: this.seq, pick })
    while (this.items.length > this.limit) this.items.shift()
    return this.seq
  }

  /** Picks queued after `seq` (exclusive). */
  after(seq: number): Array<{ seq: number; pick: ElementPick }> {
    return this.items.filter(item => item.seq > seq)
  }

  /** The newest sequence handed out (the client's next `after`). */
  sequence(): number {
    return this.seq
  }
}

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

/** Clamp a poll watermark to a non-negative integer. */
function clampAfter(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * Plugin body.
 * @param ctx - host plugin context (webServer, sessions, loader).
 * @param config - optional deployment-provided configuration.
 */
export function apply(ctx: Context, config?: ElementSourceConfig): void {
  const resolved: Required<Pick<ElementSourceConfig, 'autoSteer'>> & ElementSourceConfig = {
    // A pick is a selection, not a request: keep the chat quiet until the
    // user sends the located-source draft themselves.
    autoSteer: config?.autoSteer ?? false,
    ...config,
  }
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHostsOf(ctx))
  const queue = new PickQueue()

  // ── Routes ───────────────────────────────────────────────────────────────
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
      if (pathname === `${ROUTE_PREFIX}/api/pick`) {
        await handlePick(queue, req, res)
        return
      }
      if (pathname === `${ROUTE_PREFIX}/api/pending`) {
        await handlePending(ctx, resolved, queue, fence, req, res)
        return
      }
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown route ${pathname}` } })
    },
  }), 'dsh-element-source: routes')

  // ── System-prompt section ───────────────────────────────────────────────
  const systemPrompt = ctx.get('systemPrompt') as EsSystemPromptService | undefined
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'dsh-element-source',
      order: 60,
      text: SYSTEM_PROMPT_SECTION,
    }), 'dsh-element-source: system prompt section')
  }
}

/** Accept one pick from any page and queue it (write-only; never returns pick data). */
async function handlePick(queue: PickQueue, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    writeCorsJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const body = await readJsonBody(req)
    const pick = pickFromUnknown(body)
    if (pick === undefined) {
      writeCorsJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid pick payload' } })
      return
    }
    queue.push(pick)
    res.writeHead(204, CORS_HEADERS)
    res.end()
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 400
    writeCorsJson(res, status, {
      ok: false,
      error: { code: 'bad-request', message: error instanceof Error ? error.message : 'bad request' },
    })
  }
}

/** Drain and resolve the picks queued after the caller's watermark. */
async function handlePending(
  ctx: Context,
  config: Required<Pick<ElementSourceConfig, 'autoSteer'>> & ElementSourceConfig,
  queue: PickQueue,
  fence: (req: IncomingMessage) => boolean,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  if (req.method !== 'GET') {
    writeCorsJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  if (!fence(req)) {
    writeCorsJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const requestedId = config.sessionId ?? (url.searchParams.get('sessionId') ?? '')
  // Resolution runs only for a real session: an unknown id must never let a
  // caller resolve against an arbitrary directory it names itself. Session ids
  // are stored as `session-<uuid>`; the bare uuid is accepted too.
  const found = sessionById(ctx, requestedId)
  if (found === undefined) {
    writeCorsJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown session' } })
    return
  }
  const sessionId = found.id
  const cwd = sessionCwdOf(ctx, sessionId, url.searchParams.get('cwd') ?? undefined)
  const after = clampAfter(Number(url.searchParams.get('after') ?? '0'))
  const results: PendingResult[] = []
  for (const entry of queue.after(after)) {
    const located = await resolvePick(entry.pick, {
      cwd,
      mappings: config.mappings,
      frameworkHint: entry.pick.framework,
    })
    if ('error' in located) {
      results.push({ seq: entry.seq, ok: false, error: located.error, framework: entry.pick.framework })
      continue
    }
    results.push({
      seq: entry.seq,
      ok: true,
      relative: located.relative,
      line: located.line,
      column: located.column,
      snippet: located.snippet,
      method: located.method,
      framework: entry.pick.framework,
    })
    await maybeSteer(ctx, config.autoSteer, entry.pick, sessionId, located)
  }
  writeCorsJson(res, 200, { ok: true, value: { sequence: queue.sequence(), results } })
}

/** Resolve a session by id, tolerating the bare-uuid form (`session-<uuid>` is canonical). */
function sessionById(ctx: Context, raw: string): { id: string; session: { header: { cwd?: string } } } | undefined {
  if (raw === '') return undefined
  const direct = ctx.sessions.get(raw)
  if (direct !== undefined) return { id: raw, session: direct }
  const alternate = raw.startsWith('session-') ? raw.slice('session-'.length) : `session-${raw}`
  const alt = ctx.sessions.get(alternate)
  return alt === undefined ? undefined : { id: alternate, session: alt }
}

/** Deliver the steering message when enabled and the session's agent is live. */
async function maybeSteer(
  ctx: Context,
  autoSteer: boolean,
  pick: ElementPick,
  sessionId: string,
  located: LocatedSource,
): Promise<boolean> {
  if (!autoSteer) return false
  const agents = ctx.get('agents') as EsAgentsService | undefined
  if (agents === undefined) return false
  const agent = agents.get(sessionId)
  if (agent === undefined) return false
  const message = createUserMessage({
    content: [{ type: 'text', text: buildSteerText(located, pick.element, pick.pageUrl) }],
    source: { kind: 'plugin', plugin: 'dsh-element-source' },
  })
  agent.steer(message)
  return true
}
