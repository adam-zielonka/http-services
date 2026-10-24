#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createService, configuredOrigins } from './safe-fetch.js'
createService('image', {
  allowedOrigins: configuredOrigins(),
  html: readFileSync(new URL('./img.html', import.meta.url), 'utf8'),
}).listen(Number(process.env.PORT ?? 8000), '127.0.0.1', () => console.log('Image service listening on loopback'))
