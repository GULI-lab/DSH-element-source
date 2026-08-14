/**
 * Typed fetch wrapper over the plugin's host API. Every call posts to
 * `/dsh-element-source/api/<method>` with the session scope threaded through.
 */
import type { ElementPick, ResolveResult } from '../protocol.ts'

/** The fixed route prefix the host half registers (see src/index.ts). */
export const API_PREFIX = '/dsh-element-source'

/** One resolve request body. */
export interface ResolveRequest {
  sessionId: string
  cwd?: string
  pick: ElementPick
  /** Override the host's autoSteer config for this one request. */
  autoSteer?: boolean
}

/** A wire failure with a stable code when the host answered. */
export class ElementSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Resolve one pick to a workspace-confined source location. */
export async function resolveLocation(request: ResolveRequest, signal?: AbortSignal): Promise<ResolveResult> {
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}/api/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    throw new ElementSourceError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new ElementSourceError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as ResolveResult
}
