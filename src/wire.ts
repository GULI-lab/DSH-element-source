/**
 * Wire helpers for the plugin's JSON API: bounded body reading, response
 * writing, and the shared error envelope.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Machine-readable error codes of the plugin API. */
export type ApiErrorCode =
  | 'bad-request'
  | 'forbidden'
  | 'method-error'
  | 'not-found'
  | 'resolve-error'
  | 'internal'

/** One API failure with its wire code and HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20

/** Success envelope of one API method. */
export interface ApiOk<T> { ok: true; value: T }

/** Failure envelope of one API method. */
export interface ApiErr { ok: false; error: { code: ApiErrorCode; message: string } }

/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new ApiError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError('bad-request', 'request body is not valid JSON')
  }
}

/** Write a JSON response with the given status. */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Write the success envelope. */
export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope for any thrown value (unknown → internal 500). */
export function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/** Narrow an unknown payload value to a string, else throw bad-request. */
export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value === '') {
    throw new ApiError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}

/** Narrow an unknown payload value to a record, else throw bad-request. */
export function requireRecord(payload: unknown, key: string): Record<string, unknown> {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('bad-request', `missing or invalid "${key}"`)
  }
  return value as Record<string, unknown>
}
