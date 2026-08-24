import 'server-only'

/**
 * Native Things Cloud client.
 *
 * Cultured Code publish no API. This speaks the same protocol Things.app uses,
 * as reverse-engineered by github.com/arthursoares/things-cloud-sdk (MIT) —
 * which means it can break whenever Things changes, so every caller must treat
 * a failure here as "Things is unavailable", never as a fatal error.
 *
 * The protocol is an event log. A history is an append-only stream of items,
 * each one a create/modify/delete of a task, area or tag. Reading your tasks
 * means replaying the stream; see things-store for the materialised view.
 */

/** Overridable so the protocol can be exercised against a stub in tests. */
function endpoint(): string {
  return (process.env.THINGS_CLOUD_ENDPOINT || 'https://cloud.culturedcode.com').replace(/\/+$/, '')
}
const USER_AGENT = 'ThingsMac/32209501'
/** A page of history can be large, so reading one is given room. */
const REQUEST_TIMEOUT_MS = 30_000
/**
 * A liveness check is not: it runs on every status poll, and letting it hang
 * for half a minute ties up the server for no answer anyone is waiting on.
 */
const VERIFY_TIMEOUT_MS = 8_000

/** Sent as base64 JSON in Things-Client-Info; the server expects it present. */
const CLIENT_INFO = {
  dm: 'MacBookPro18,3',
  lr: 'US',
  nf: true,
  nk: true,
  nn: 'ThingsMac',
  nv: '32209501',
  on: 'macOS',
  ov: '15.7.3',
  pl: 'en-US',
  ul: 'en-Latn-US',
}

export interface ThingsCredentials {
  email: string
  password: string
}

export class ThingsAuthError extends Error {}
export class ThingsCloudError extends Error {}

/** Item kinds we care about; everything else is ignored on replay. */
export const TASK_KINDS = new Set(['Task6', 'Task4', 'Task3', 'Task'])
export const AREA_KINDS = new Set(['Area3', 'Area2', 'Area'])
export const TAG_KINDS = new Set(['Tag3', 'Tag4', 'Tag'])

export const ACTION_CREATED = 0
export const ACTION_MODIFIED = 1
export const ACTION_DELETED = 2

/** Status values on the wire: 0 open, 2 cancelled, 3 completed. */
export const STATUS_COMPLETED = 3

export interface ThingsItem {
  uuid: string
  kind: string
  action: number
  payload: Record<string, unknown>
}

export interface ThingsItemBatch {
  items: ThingsItem[]
  /** Server head; caught up once the loaded index reaches it. */
  currentItemIndex: number
}

function headers(creds: ThingsCredentials, withBody: boolean): Record<string, string> {
  const base: Record<string, string> = {
    Authorization: `Password ${creds.password}`,
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    'Accept-Charset': 'UTF-8',
    'Things-Client-Info': Buffer.from(JSON.stringify(CLIENT_INFO)).toString('base64'),
  }
  if (withBody) base['Content-Type'] = 'application/json; charset=UTF-8'
  return base
}

async function request(
  path: string,
  creds: ThingsCredentials,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${endpoint()}${path}`, {
      ...init,
      headers: { ...headers(creds, Boolean(init.body)), ...(init.headers as Record<string, string> ?? {}) },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) {
      throw new ThingsAuthError('Things rejected those credentials.')
    }
    if (!res.ok) {
      throw new ThingsCloudError(`Things Cloud returned ${res.status}`)
    }
    return res
  } catch (err) {
    if (err instanceof ThingsAuthError || err instanceof ThingsCloudError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ThingsCloudError('Things Cloud timed out')
    }
    throw new ThingsCloudError(err instanceof Error ? err.message : 'Things Cloud unreachable')
  } finally {
    clearTimeout(timer)
  }
}

export interface ThingsAccount {
  email: string
  /** The id of this account's sync stream. */
  historyKey: string
}

/**
 * Checks credentials and returns the account's history key, which every
 * subsequent read and write is addressed to.
 */
export async function verifyAccount(creds: ThingsCredentials): Promise<ThingsAccount> {
  const res = await request(`/version/1/account/${encodeURIComponent(creds.email)}`, creds, {}, VERIFY_TIMEOUT_MS)
  const body = await res.json() as { email?: string; 'history-key'?: string }
  const historyKey = body['history-key']
  if (!historyKey) {
    throw new ThingsCloudError('Things did not return a sync key for this account.')
  }
  return { email: body.email ?? creds.email, historyKey }
}

/** One page of the event log, starting at `startIndex`. */
export async function fetchItems(
  creds: ThingsCredentials,
  historyKey: string,
  startIndex: number,
): Promise<ThingsItemBatch> {
  const res = await request(
    `/version/1/history/${encodeURIComponent(historyKey)}/items?start-index=${startIndex}`,
    creds,
  )
  const body = await res.json() as {
    items?: Array<Record<string, { p?: Record<string, unknown>; e?: string; t?: number }>>
    'current-item-index'?: number
  }

  const items: ThingsItem[] = []
  for (const entry of body.items ?? []) {
    for (const [uuid, item] of Object.entries(entry)) {
      items.push({
        uuid,
        kind: item.e ?? '',
        action: item.t ?? ACTION_CREATED,
        payload: item.p ?? {},
      })
    }
  }
  return { items, currentItemIndex: body['current-item-index'] ?? startIndex + (body.items?.length ?? 0) }
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** Unix seconds with sub-second precision, the only time format on the wire. */
export function nowTimestamp(): number {
  return Date.now() / 1000
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

/** Things checksums note text with CRC-32 (IEEE) and rejects a mismatch. */
export function noteChecksum(text: string): number {
  const bytes = Buffer.from(text, 'utf8')
  let crc = -1
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF]
  }
  return (crc ^ -1) >>> 0
}

export function encodeNote(text: string) {
  return { _t: 'tx', ch: noteChecksum(text), v: text, t: 1 }
}

/**
 * Reads whatever shape a note arrived in. Older histories store raw XML, newer
 * ones a full-text object; incremental patch notes ("t": 2) can't be resolved
 * without the prior text, so they leave the stored note alone.
 */
export function decodeNote(raw: unknown, previous: string): string {
  if (raw === null || raw === undefined) return previous
  if (typeof raw === 'string') {
    return raw.replace(/^<note[^>]*>/, '').replace(/<\/note>$/, '')
  }
  if (typeof raw === 'object') {
    const note = raw as { t?: number; v?: string }
    if (note.t === 1) return note.v ?? ''
    // Delta note: not enough information here to apply it safely.
    return previous
  }
  return previous
}

/**
 * Appends one change to the stream. `ancestorIndex` is the writer's view of the
 * server head — Things uses it to order concurrent commits.
 */
export async function commitItem(
  creds: ThingsCredentials,
  historyKey: string,
  ancestorIndex: number,
  uuid: string,
  kind: string,
  fields: Record<string, unknown>,
): Promise<number> {
  const body = JSON.stringify({ [uuid]: { t: ACTION_MODIFIED, e: kind, p: fields } })
  const res = await request(
    `/version/1/history/${encodeURIComponent(historyKey)}/commit?ancestor-index=${ancestorIndex}&_cnt=1`,
    creds,
    {
      method: 'POST',
      body,
      headers: {
        Schema: '301',
        'Push-Priority': '5',
        'App-Id': 'com.culturedcode.ThingsMac',
        'App-Instance-Id':
          '000000000000000000000000000000000000000000000000000000000000000'
          + '-com.culturedcode.ThingsMac-'
          + '000000000000000000000000000000000000000000000000000000000000000',
      },
    },
  )
  const out = await res.json() as { 'server-head-index'?: number }
  return out['server-head-index'] ?? ancestorIndex
}

/** Marks a to-do done, exactly as Things.app does. */
export function completedFields() {
  return { md: nowTimestamp(), ss: STATUS_COMPLETED, sp: nowTimestamp() }
}

export function noteFields(text: string) {
  return { md: nowTimestamp(), nt: encodeNote(text) }
}
