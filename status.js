#!/usr/bin/env node
import { createService, configuredOrigins } from './safe-fetch.js'
createService('status', { allowedOrigins: configuredOrigins() })
  .listen(Number(process.env.PORT ?? 8000), '127.0.0.1', () => console.log('Status service listening on loopback'))
