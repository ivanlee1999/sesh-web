import { openDB, type IDBPDatabase } from 'idb'
import type { Session } from '@/types'

const DB_NAME = 'sesh-db'
const DB_VERSION = 1
const STORE_NAME = 'sessions'

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('startedAt', 'startedAt')
          store.createIndex('category', 'category')
          store.createIndex('type', 'type')
        }
      },
    })
  }
  return dbPromise
}

export async function saveSession(session: Session): Promise<void> {
  const db = await getDB()
  await db.put(STORE_NAME, session)
}

export async function getAllSessions(): Promise<Session[]> {
  const db = await getDB()
  const sessions = await db.getAllFromIndex(STORE_NAME, 'startedAt')
  return sessions.reverse()
}

export async function getSessionsInRange(start: number, end: number): Promise<Session[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex(STORE_NAME, 'startedAt', IDBKeyRange.bound(start, end))
  return all
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, id)
}
