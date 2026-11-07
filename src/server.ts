import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { serve } from './handler.ts'

const port = Number(process.env.PORT ?? 3000)

const server = createServer((req, res) => {
  void serve(req, res)
})

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return serve(req, res)
}

if (process.env.VERCEL !== '1') {
  process.env.USE_EMBEDDED_DB = '1'
  server.listen(port)
}
