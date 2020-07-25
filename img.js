#!/usr/bin/env -S deno run --allow-net --allow-read=img.html
import { serve } from "https://deno.land/std@0.62.0/http/server.ts"

const html = Deno.readFileSync('img.html')

async function readBody(req) {
  const buffer = new Uint8Array(req.contentLength)
  await req.body.read(buffer)
  return new TextDecoder('utf-8').decode(buffer)
}

async function base64Fetch(url) {
  const reduceToString = (result, charCode) => result + String.fromCharCode(charCode)

  const response = await fetch(new Request(url), { headers: { Accept: '*/*' } })
  const type = response.headers.get("Content-Type")
  const buffer = await response.arrayBuffer()
  const data = await btoa(Array.from(new Uint8Array(buffer)).reduce(reduceToString, ''))

  return `data:${type};base64,${data.toString()}`
}

console.log("http://localhost:8000/")
for await (const req of serve({ port: 8000 })) {
  if (req.method === 'POST') {
    try {
      req.respond({ body: await base64Fetch(await readBody(req)) })
    } catch (error) {
      req.respond({ body: error.toString(), status: 400 })
    }
  } else {
    req.respond({ body: html })
  }
}
