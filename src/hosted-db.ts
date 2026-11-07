import pg from 'pg'

export type Database = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(text: string): Promise<void>
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function openPostgres(databaseUrl: string): Database {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 })
  pool.on('error', (error: unknown) => {
    console.error(error)
  })
  return {
    query: async (text, params) => {
      const result = params === undefined ? await pool.query(text) : await pool.query(text, params)
      return { rows: result.rows }
    },
    exec: async () => {
      throw new Error('schema')
    },
    transaction: async (fn) => {
      const client = await pool.connect()
      const tx = clientDatabase(client)
      try {
        await client.query('BEGIN')
        const value = await fn(tx)
        await client.query('COMMIT')
        return value
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

function clientDatabase(client: pg.PoolClient): Database {
  const database: Database = {
    query: async (text, params) => {
      const result = params === undefined ? await client.query(text) : await client.query(text, params)
      return { rows: result.rows }
    },
    exec: async () => {
      throw new Error('schema')
    },
    transaction: (fn) => fn(database),
    close: async () => {},
  }
  return database
}
