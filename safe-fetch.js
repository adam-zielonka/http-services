import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

export class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) === 6) {
    const [first, second = '0'] = address.toLowerCase().split(':')
    const a = parseInt(first, 16), b = parseInt(second || '0', 16)
    // Global unicast only, excluding transition, documentation and special-use ranges.
    return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && a !== 0x3ffe && a !== 0x3fff &&
      !(a === 0x2001 && (b < 0x0200 || b === 0x0db8))
  }
  return false
}

export function parseTarget(value, allowedOrigins) {
  let url
  try { url = new URL(value) } catch { throw new RequestError('Invalid URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !allowedOrigins.has(url.origin)) throw new RequestError('Origin is not allowed', 403)
  return url
}

export async function resolveTarget(url, resolver = lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
    : await resolver(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new RequestError('Private or reserved network target rejected', 403)
  }
  return addresses[0]
}

export function pinnedRequest(url, address, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(url, {
      method: 'GET', signal, agent: false,
      headers: { Accept: '*/*', 'Accept-Encoding': 'identity' },
      // Preserve Host/TLS hostname, connect to the IP already checked (no DNS rebinding).
      lookup: (_host, options, done) => options.all
        ? done(null, [address]) : done(null, address.address, address.family),
    }, response => {
      const status = response.statusCode ?? 502
      const headers = response.headers
      if (status >= 300 && status < 400) {
        response.destroy()
        resolve({ status, headers, body: Buffer.alloc(0) }); return
      }
      const chunks = []; let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          const error = new RequestError('Upstream response too large', 413)
          response.destroy(error); reject(error)
        } else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }))
    })
    request.on('error', reject)
    request.end()
  })
}

export async function safeFetch(value, allowedOrigins, { resolver = lookup, transport = pinnedRequest, timeoutMs = 5000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); reject(new RequestError('Upstream timeout', 504))
    }, timeoutMs)
  })
  try {
    return await Promise.race([timeout, (async () => {
      let url = parseTarget(value, allowedOrigins)
      for (let redirects = 0; redirects <= 3; redirects++) {
        const address = await resolveTarget(url, resolver)
        controller.signal.throwIfAborted()
        const result = await transport(url, address, controller.signal, maxBytes)
        if (result.status >= 300 && result.status < 400 && result.headers.location) {
          url = parseTarget(new URL(result.headers.location, url).href, allowedOrigins)
        } else return result
      }
      throw new RequestError('Too many redirects')
    })()])
  } finally { clearTimeout(timer); controller.abort() }
}

export async function readBody(request, maxBytes = 2048) {
  const chunks = []; let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new RequestError('Request body too large', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

export function createService(mode, { allowedOrigins = new Set(), fetcher = safeFetch, html = '' } = {}) {
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    if (request.method === 'GET') {
      if (mode === 'image') response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(mode === 'image' ? html : '200 Online'); return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'GET, POST' }); response.end(); return
    }
    try {
      const result = await fetcher(await readBody(request), allowedOrigins)
      if (mode === 'image') {
        const type = (result.headers['content-type'] ?? '').split(';')[0].toLowerCase()
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(type)) {
          throw new RequestError('Only raster images are accepted')
        }
        response.end(`data:${type};base64,${result.body.toString('base64')}`)
      } else response.end(String(result.status))
    } catch (error) {
      response.statusCode = error instanceof RequestError ? error.status : 502
      response.end(error instanceof RequestError ? error.message : 'Upstream request failed')
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  return server
}

export function configuredOrigins(value = process.env.FETCH_ALLOWED_ORIGINS ?? '') {
  return new Set(value.split(',').filter(Boolean).map(item => {
    const url = new URL(item.trim())
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        !['http:', 'https:'].includes(url.protocol)) throw new Error('Configure exact HTTP(S) origins only')
    return url.origin
  }))
}
