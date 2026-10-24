import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createService, isPublicAddress, parseTarget, readBody, safeFetch, configuredOrigins } from './safe-fetch.js'
const allowed = new Set(['https://example.com'])
const publicResolver = async () => [{ address: '93.184.215.14', family: 4 }]
test('private, reserved, mapped and transition networks are rejected', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address)
  assert.equal(isPublicAddress('93.184.215.14'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})
test('targets need exact HTTP(S) origins and no credentials', () => {
  for (const url of ['file:///etc/passwd', 'https://example.com.attacker.test/', 'https://example.com:444/', 'https://user:pass@example.com/', 'http://example.com/']) assert.throws(() => parseTarget(url, allowed))
  assert.throws(() => parseTarget('https://example.com', new Set()))
  assert.equal(parseTarget('https://example.com/a', allowed).pathname, '/a')
  assert.throws(() => configuredOrigins('https://example.com/path'))
})
test('mixed DNS answers are rejected before connecting', async () => {
  let connections = 0
  await assert.rejects(safeFetch('https://example.com', allowed, {
    resolver: async () => [{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }],
    transport: async () => { connections++ },
  }), /Private/)
  assert.equal(connections, 0)
})
test('validated address is pinned and redirect origins rechecked', async () => {
  let calls = 0
  await assert.rejects(safeFetch('https://example.com', allowed, {
    resolver: publicResolver,
    transport: async (url, address) => {
      calls++; assert.equal(address.address, '93.184.215.14'); assert.equal(url.hostname, 'example.com')
      return { status: 302, headers: { location: 'http://127.0.0.1/' } }
    },
  }), /not allowed/)
  assert.equal(calls, 1)
})
test('redirects to allowed origins also recheck DNS', async () => {
  let resolutions = 0
  await assert.rejects(safeFetch('https://example.com', allowed, {
    resolver: async () => [{ address: ++resolutions === 1 ? '93.184.215.14' : '127.0.0.1', family: 4 }],
    transport: async () => ({ status: 302, headers: { location: '/next' } }),
  }), /Private/)
})
test('DNS and upstream work share a total timeout', async () => {
  await assert.rejects(safeFetch('https://example.com', allowed, { resolver: () => new Promise(() => {}), timeoutMs: 10 }), /timeout/)
})
test('request bodies are bounded', async () => {
  await assert.rejects(readBody(Readable.from([Buffer.alloc(2049)])), /too large/)
})
test('service never treats upstream HTML as an image', async t => {
  const server = createService('image', { fetcher: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<script>') }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const result = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', body: 'https://example.com' })
  assert.equal(result.status, 400)
  assert.match(await result.text(), /raster/)
})
