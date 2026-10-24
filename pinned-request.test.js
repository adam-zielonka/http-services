import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { pinnedRequest } from './safe-fetch.js'

test('connection uses the validated IP and preserves original Host', async t => {
  let host
  const server = http.createServer((req, res) => { host = req.headers.host; res.end('ok') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const port = server.address().port
  const result = await pinnedRequest(new URL(`http://not-a-real-host.invalid:${port}/`),
    { address: '127.0.0.1', family: 4 }, AbortSignal.timeout(1000), 1024)
  assert.equal(result.body.toString(), 'ok')
  assert.equal(host, `not-a-real-host.invalid:${port}`)
})

test('upstream response size is enforced while streaming', async t => {
  const server = http.createServer((_req, res) => res.end(Buffer.alloc(4096)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  await assert.rejects(pinnedRequest(new URL(`http://example.invalid:${server.address().port}`),
    { address: '127.0.0.1', family: 4 }, AbortSignal.timeout(1000), 1024), /too large/)
})
