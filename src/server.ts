import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { serve } from './handler.ts'

const parsedPort = Number(process.env.PORT)
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000

const server = createServer((req, res) => {
  void serve(req, res)
})

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return serve(req, res)
}

server.on('error', (error) => {
  console.error(error)
})
server.listen(port)
