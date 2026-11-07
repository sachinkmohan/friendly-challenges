import { cert, deleteApp, initializeApp, type App, type AppOptions } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { FirebaseWebConfig } from './identity.ts'

export type Database = Firestore

const DEMO_PROJECT = 'demo-friendly-challenges'
const apps = new WeakMap<Firestore, App>()

function appOptions(projectId: string | undefined): AppOptions {
  if (process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
    return { projectId: projectId ?? (process.env.FIREBASE_PROJECT_ID?.trim() || DEMO_PROJECT) }
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim() ?? ''
  if (raw === '') throw new Error('Firestore is not configured. Set FIREBASE_SERVICE_ACCOUNT or FIRESTORE_EMULATOR_HOST.')
  const account = JSON.parse(raw) as { project_id?: unknown; client_email?: unknown; private_key?: unknown }
  if (typeof account.project_id !== 'string' || typeof account.client_email !== 'string' || typeof account.private_key !== 'string') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not a service account key.')
  }
  return {
    projectId: account.project_id,
    credential: cert({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key }),
  }
}

// Each call gets its own app, so a test can open an empty emulator project of its own.
export function openDatabase(projectId?: string): Database {
  const app = initializeApp(appOptions(projectId), `db-${crypto.randomUUID()}`)
  const db = getFirestore(app)
  apps.set(db, app)
  return db
}

export function openTestDatabase(): Database {
  return openDatabase(`demo-test-${crypto.randomUUID()}`)
}

function appFor(db: Database): App {
  const app = apps.get(db)
  if (!app) throw new Error('This database was not opened by openDatabase.')
  return app
}

export function authFor(db: Database): Auth {
  return getAuth(appFor(db))
}

export function firebaseWebConfig(db: Database): FirebaseWebConfig | null {
  const apiKey = process.env.FIREBASE_API_KEY?.trim() ?? ''
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN?.trim() ?? ''
  const projectId = appFor(db).options.projectId ?? ''
  if (apiKey === '' || authDomain === '' || projectId === '') return null
  return { apiKey, authDomain, projectId }
}

export async function closeDatabase(db: Database): Promise<void> {
  const app = apps.get(db)
  await db.terminate()
  if (app) await deleteApp(app)
}
