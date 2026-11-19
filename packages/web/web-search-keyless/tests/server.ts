/** A loopback HTTP server standing in for every search source, plus the recorded fixtures. */

import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One request the stand-in received. */
export interface Received {
  readonly method: string
  readonly url: URL
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

/** Answer one request. */
export type Handler = (request: Received, response: ServerResponse) => void

/** A running stand-in. */
export interface SourceServer {
  /** Origin, such as `http://127.0.0.1:12345`. */
  readonly origin: string
  /** Every request received so far. */
  readonly received: Received[]
  /** Replace the handler. */
  handle(handler: Handler): void
  close(): Promise<void>
}

/**
 * Start a stand-in on an ephemeral loopback port.
 * @param handler - initial handler.
 * @returns the running server.
 */
export async function startSourceServer(handler: Handler): Promise<SourceServer> {
  let current = handler
  const received: Received[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const entry: Received = {
        method: request.method ?? 'GET',
        url: new URL(request.url ?? '/', 'http://stand-in.test'),
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      received.push(entry)
      current(entry, response)
    })
  })
  const listening = Promise.withResolvers<undefined>()
  server.listen(0, '127.0.0.1', () => { listening.resolve(undefined) })
  await listening.promise
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    received,
    handle(next) { current = next },
    close() {
      const closed = Promise.withResolvers<undefined>()
      server.closeAllConnections()
      server.close(() => { closed.resolve(undefined) })
      return closed.promise
    },
  }
}

/**
 * Read a recorded fixture.
 * @param name - file name under `tests/fixtures`.
 * @returns its text.
 */
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

/**
 * Send a body with a status and content type.
 * @param response - the response to write.
 * @param status - HTTP status.
 * @param body - response text.
 * @param type - content type.
 */
export function reply(response: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8'): void {
  response.writeHead(status, { 'content-type': type })
  response.end(body)
}
