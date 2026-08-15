/**
 * Host-side source resolution: turn one page pick into a concrete
 * `file[:line[:column]]` inside the session workspace.
 *
 * Sources of precision, in order:
 *  1. The probe script already found exact metadata (code-inspector
 *     `data-insp-*` attributes, React dev `__source`, Vue `__file`,
 *     Svelte dev `__svelte_meta`). We normalize the reported path and
 *     confine it to the workspace.
 *  2. Otherwise a text search over the workspace source tree locates the
 *     clicked text (Vue template text, JSX text nodes, …) and the line.
 *  3. Otherwise a component-name search locates the component definition.
 *
 * Every resolved path MUST stay inside the session cwd; anything outside is
 * refused so a malicious page cannot make the plugin read arbitrary files.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import type { ElementPick, ResolveMethod } from './protocol.ts'
import { normalizeSearchText } from './protocol.ts'

/** One source-path prefix mapping (like code-inspector's `mappings`). */
export interface SourceMapping {
  /** Path prefix to find (e.g. `@scope/pkg/src`). */
  find: string
  /** Replacement prefix (e.g. the monorepo directory or `node_modules/…`). */
  replacement: string
}

/** Options controlling one resolution. */
export interface ResolveOptions {
  /** The session's authoritative working directory (must be absolute). */
  cwd: string
  /** Optional source-path prefix mappings, applied before normalization. */
  mappings?: readonly SourceMapping[]
  /** Extensions the text fallback search reads (without leading dot). */
  searchExtensions?: readonly string[]
  /** Maximum directory depth of the fallback search. */
  maxDepth?: number
  /** Maximum bytes of one file the fallback search reads. */
  maxFileBytes?: number
  /** Maximum files the fallback search examines. */
  maxFiles?: number
  /** Framework hint that biases which extensions the text search tries first. */
  frameworkHint?: ElementPick['framework']
}

/** The located source, always workspace-confined. */
export interface LocatedSource {
  ok: true
  /** Absolute path on disk. */
  file: string
  /** Path relative to the session cwd. */
  relative: string
  line?: number
  column?: number
  /** The source line (or the 3-line window around it) when a line is known. */
  snippet?: string
  method: ResolveMethod
  /** Whether the file exists on disk (false = located by search but not read). */
  existed: boolean
}

export const DEFAULT_SEARCH_EXTENSIONS = [
  'vue', 'jsx', 'tsx', 'js', 'ts', 'mjs', 'cjs', 'svelte', 'html', 'htm',
  'css', 'scss', 'less', 'styl',
] as const

/** Directories the fallback search never descends into. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.output', '.svelte-kit', 'target', '__pycache__', '.cache',
])

/** True when `target` equals `root` or sits below it. */
export function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The refusal message for a source outside the session workspace. */
export function outsideWorkspaceMessage(file: string): string {
  return `located file is outside the session workspace: ${file} —— 请把会话工作区切换到项目目录（如侧边栏选择项目文件夹）再试 / switch the session workspace to your project and retry`
}

/** True when `raw` looks like a Windows drive path (with or without leading /). */
function isWindowsDrive(raw: string): boolean {
  return /^(\/)?[A-Za-z]:[\\/]/.test(raw)
}

/** Strip a `file://` prefix and a leading slash in front of a Windows drive. */
function cleanUrlStyle(raw: string): string {
  let out = raw
  if (out.startsWith('file://')) out = out.slice('file://'.length)
  if (isWindowsDrive(out) && out.startsWith('/')) out = out.slice(1)
  return out
}

/**
 * Build the ordered candidate absolute paths for one reported source path.
 * Webpack-style project-relative paths (`/src/App.vue`) join the cwd; Vite
 * dev builds report absolute fs paths which pass through.
 */
export function candidatePaths(raw: string, cwd: string, mappings?: readonly SourceMapping[]): string[] {
  let source = raw.trim()
  if (source === '') return []
  // Apply prefix mappings first so monorepo / node_modules paths can be
  // rebased onto the checkout the user actually edits.
  for (const mapping of mappings ?? []) {
    if (mapping.find !== '' && source.startsWith(mapping.find)) {
      source = mapping.replacement + source.slice(mapping.find.length)
      break
    }
  }
  source = cleanUrlStyle(source)
  const candidates = new Set<string>()
  if (isAbsolute(source) || isWindowsDrive(source)) candidates.add(cleanUrlStyle(source))
  // A leading slash on a non-drive path is project-relative in webpack dev.
  candidates.add(join(cwd, source))
  candidates.add(resolvePath(cwd, source))
  return [...candidates].filter(candidate => candidate !== '')
}

/** Read the 3-line window around `line` (1-based) as the snippet. */
async function readSnippet(file: string, line?: number): Promise<string | undefined> {
  if (line === undefined || line < 1) return undefined
  try {
    const content = await readFile(file, 'utf8')
    const lines = content.split(/\r?\n/)
    const start = Math.max(0, line - 2)
    const end = Math.min(lines.length, line + 1)
    if (start >= end) return undefined
    return lines.slice(start, end).join('\n')
  } catch {
    return undefined
  }
}

/** Whether a file exists on disk. */
export async function fileExists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

/** Pick the first existing candidate; undefined when none exist. */
export async function firstExisting(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}

/** Search keys derived from an element descriptor. */
export interface SearchKeys {
  /** Normalized text, when long enough to be distinctive. */
  text?: string
  classes: string[]
  id?: string
  /** Component display name reported by a framework probe. */
  name?: string
}

const MIN_TEXT_LENGTH = 2

/** Build the search keys for one pick. */
export function searchKeysOf(pick: ElementPick): SearchKeys {
  const text = pick.element.text !== undefined
    ? normalizeSearchText(pick.element.text)
    : undefined
  return {
    text: text !== undefined && Array.from(text).length >= MIN_TEXT_LENGTH ? text : undefined,
    classes: pick.element.classes.filter(cls => cls.length >= 3),
    id: pick.element.id,
    name: pick.name !== undefined && pick.name !== '' ? pick.name : undefined,
  }
}

/** Framework-biased extension preference for the text search. */
function frameworkExtensions(framework: ElementPick['framework']): readonly string[] | undefined {
  switch (framework) {
    case 'vue': return ['vue', 'html', 'js', 'ts']
    case 'react': return ['jsx', 'tsx', 'js', 'ts']
    case 'svelte': return ['svelte', 'html', 'js', 'ts']
    case 'angular': return ['html', 'ts', 'scss', 'css']
    default: return undefined
  }
}

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One text-search hit. */
export interface TextHit {
  file: string
  line: number
  /** The matched source line, trimmed. */
  matched: string
}

/**
 * Depth-first text search over the workspace for the first source line that
 * contains one of the keys. When a framework hint is given, a first pass
 * scans only the framework's own file types (a Vue template hit beats a
 * stray hit in a `.js` bundle), then a second pass covers every configured
 * extension.
 */
export async function searchWorkspace(
  cwd: string,
  keys: SearchKeys,
  options: ResolveOptions,
): Promise<TextHit | undefined> {
  const all = new Set(options.searchExtensions ?? DEFAULT_SEARCH_EXTENSIONS)
  const patterns: Array<{ text: string; kind: 'text' | 'class' | 'id' }> = []
  if (keys.text !== undefined) patterns.push({ text: keys.text, kind: 'text' })
  for (const cls of keys.classes) patterns.push({ text: cls, kind: 'class' })
  if (keys.id !== undefined) patterns.push({ text: keys.id, kind: 'id' })
  if (patterns.length === 0) return undefined

  const maxFiles = options.maxFiles ?? 4000
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024
  const maxDepth = options.maxDepth ?? 6

  const walk = async (extensions: Set<string>): Promise<TextHit | undefined> => {
    let filesExamined = 0
    const scan = async (dir: string, depth: number): Promise<TextHit | undefined> => {
      if (depth > maxDepth || filesExamined >= maxFiles) return undefined
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (filesExamined >= maxFiles) return undefined
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue
          const hit = await scan(full, depth + 1)
          if (hit !== undefined) return hit
          continue
        }
        if (!entry.isFile()) continue
        const dot = entry.name.lastIndexOf('.')
        const ext = dot === -1 ? '' : entry.name.slice(dot + 1).toLowerCase()
        if (!extensions.has(ext)) continue
        filesExamined += 1
        const hit = await scanFile(full, patterns, maxFileBytes)
        if (hit !== undefined) return hit
      }
      return undefined
    }
    return scan(cwd, 0)
  }

  // Pass 1: only the framework's own file types.
  const biased = frameworkExtensions(options.frameworkHint ?? 'generic')
    ?.filter(ext => all.has(ext))
  if (biased !== undefined && biased.length > 0) {
    const first = await walk(new Set(biased))
    if (first !== undefined) return first
  }
  // Pass 2: every configured extension.
  return walk(all)
}

/** Read one file (bounded) and return the first line containing a pattern. */
async function scanFile(
  file: string,
  patterns: Array<{ text: string; kind: 'text' | 'class' | 'id' }>,
  maxFileBytes: number,
): Promise<TextHit | undefined> {
  let content: string
  try {
    const info = await stat(file)
    if (info.size > maxFileBytes) return undefined
    content = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  const lines = content.split(/\r?\n/)
  // Prefer a text match (exact content) over a class/id match.
  const ordered = [...patterns].sort((a, b) => rankOf(a.kind) - rankOf(b.kind))
  for (const pattern of ordered) {
    const regex = new RegExp(escapeRegExp(pattern.text), 'i')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      if (regex.test(line)) {
        return { file, line: index + 1, matched: line.trim() }
      }
    }
  }
  return undefined
}

/** Search priority: exact text beats class/id beats component name. */
function rankOf(kind: 'text' | 'class' | 'id'): number {
  switch (kind) {
    case 'text': return 0
    case 'class': return 1
    case 'id': return 2
  }
}

/** Component-definition patterns searched when no text/class key matches. */
const COMPONENT_PATTERNS: Array<(name: string) => RegExp> = [
  name => new RegExp(`\\b(?:export\\s+)?(?:default\\s+)?(?:function\\s+)?${escapeRegExp(name)}\\s*(?:<|\\(|\\{)`),
  name => new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=`),
  name => new RegExp(`\\bname\\s*:\\s*['"]${escapeRegExp(name)}['"]`),
]

/** Locate a component name's definition inside the workspace. */
export async function searchComponent(
  cwd: string,
  name: string,
  options: ResolveOptions,
): Promise<TextHit | undefined> {
  const extensions = new Set(options.searchExtensions ?? DEFAULT_SEARCH_EXTENSIONS)
  let filesExamined = 0
  const maxFiles = options.maxFiles ?? 4000
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024
  const maxDepth = options.maxDepth ?? 6
  const patterns = COMPONENT_PATTERNS.map(make => make(name))

  const walk = async (dir: string, depth: number): Promise<TextHit | undefined> => {
    if (depth > maxDepth || filesExamined >= maxFiles) return undefined
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (filesExamined >= maxFiles) return undefined
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        const hit = await walk(full, depth + 1)
        if (hit !== undefined) return hit
        continue
      }
      if (!entry.isFile()) continue
      const dot = entry.name.lastIndexOf('.')
      const ext = dot === -1 ? '' : entry.name.slice(dot + 1).toLowerCase()
      if (!extensions.has(ext)) continue
      filesExamined += 1
      try {
        const info = await stat(full)
        if (info.size > maxFileBytes) continue
        const content = await readFile(full, 'utf8')
        const lines = content.split(/\r?\n/)
        for (const pattern of patterns) {
          for (let index = 0; index < lines.length; index += 1) {
            if (pattern.test(lines[index]!)) {
              return { file: full, line: index + 1, matched: lines[index]!.trim() }
            }
          }
        }
      } catch {
        // unreadable file: skip
      }
    }
    return undefined
  }

  return walk(cwd, 0)
}

/**
 * Resolve one pick to a workspace-confined source location.
 * @returns ok:false with `error` when nothing was found or the reported path
 * escaped the workspace.
 */
export async function resolvePick(pick: ElementPick, options: ResolveOptions): Promise<LocatedSource | { ok: false; error: string }> {
  const cwd = options.cwd
  // 1. Precise source metadata from the page probe.
  if (pick.source !== undefined && pick.source.file !== '') {
    const candidates = candidatePaths(pick.source.file, cwd, options.mappings)
    const existing = await firstExisting(candidates)
    if (existing !== undefined) {
      if (!isWithin(cwd, existing)) {
        return { ok: false, error: outsideWorkspaceMessage(existing) }
      }
      // `__file`-style probes report the file but usually not the line:
      // locate it inside the file by the clicked text / class / id.
      let line = pick.source.line
      if (line === undefined) {
        const located = await locateLineInFile(existing, pick)
        line = located.line
      }
      const method = methodFor(pick.framework, line !== undefined)
      const snippet = await readSnippet(existing, line)
      return {
        ok: true,
        file: existing,
        relative: relative(cwd, existing),
        line,
        column: pick.source.column,
        snippet,
        method,
        existed: true,
      }
    }
    // Reported path did not exist on disk — fall through to search. (Vite
    // `__file` can be absolute to a different machine layout; the text
    // search below still has a chance.)
  }

  // 2. Text / class / id search over the workspace.
  const keys = searchKeysOf(pick)
  const hit = await searchWorkspace(cwd, keys, { ...options, frameworkHint: pick.framework })
  if (hit !== undefined) {
    if (!isWithin(cwd, hit.file)) {
      return { ok: false, error: outsideWorkspaceMessage(hit.file) }
    }
    const snippet = await readSnippet(hit.file, hit.line)
    return {
      ok: true,
      file: hit.file,
      relative: relative(cwd, hit.file),
      line: hit.line,
      snippet,
      method: 'text-search',
      existed: true,
    }
  }

  // 3. Component-name search.
  if (keys.name !== undefined) {
    const componentHit = await searchComponent(cwd, keys.name, options)
    if (componentHit !== undefined) {
      if (!isWithin(cwd, componentHit.file)) {
        return { ok: false, error: outsideWorkspaceMessage(componentHit.file) }
      }
      const snippet = await readSnippet(componentHit.file, componentHit.line)
      return {
        ok: true,
        file: componentHit.file,
        relative: relative(cwd, componentHit.file),
        line: componentHit.line,
        snippet,
        method: 'component-search',
        existed: true,
      }
    }
  }

  return { ok: false, error: 'could not locate source: no file, text, class, or component name matched' }
}

/** The resolve method label for a precise framework source. */
function methodFor(framework: ElementPick['framework'], hasLine: boolean): ResolveMethod {
  switch (framework) {
    case 'code-inspector': return 'code-inspector'
    case 'react': return hasLine ? 'react-source' : 'component-search'
    case 'vue': return 'vue-file'
    case 'svelte': return hasLine ? 'svelte-source' : 'component-search'
    default: return 'component-search'
  }
}

/**
 * Locate the line of an element within ONE already-known file (Vue `__file`
 * reports the file but not the line): scan for the clicked text, then class
 * names, then the id — first match wins.
 */
export async function locateLineInFile(file: string, pick: ElementPick, maxFileBytes = 512 * 1024): Promise<{ line?: number }> {
  const keys = searchKeysOf(pick)
  const patterns: string[] = []
  if (keys.text !== undefined) patterns.push(keys.text)
  patterns.push(...keys.classes)
  if (keys.id !== undefined) patterns.push(keys.id)
  if (patterns.length === 0) return {}
  try {
    const info = await stat(file)
    if (info.size > maxFileBytes) return {}
    const content = await readFile(file, 'utf8')
    const lines = content.split(/\r?\n/)
    for (const pattern of patterns) {
      const regex = new RegExp(escapeRegExp(pattern), 'i')
      for (let index = 0; index < lines.length; index += 1) {
        if (regex.test(lines[index]!)) return { line: index + 1 }
      }
    }
  } catch {
    // Unreadable file: no line.
  }
  return {}
}

/** Normalize the separator in a relative path for display. */
export function displayRelative(cwd: string, file: string): string {
  return relative(cwd, file).split(sep).join('/')
}
