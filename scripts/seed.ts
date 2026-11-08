import { closeDatabase, openDatabase, usesEmulator } from '../src/db.ts'
import { loadSample } from '../src/sample.ts'

if (!process.env.FIREBASE_SERVICE_ACCOUNT?.trim() && !usesEmulator()) {
  console.log('seed: nothing to do')
  process.exit(0)
}
const db = openDatabase()
try {
  await loadSample(db)
  console.log('seed: Pantry is in place')
} finally {
  await closeDatabase(db)
}
