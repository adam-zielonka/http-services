#!/usr/bin/env -S deno run --allow-net
import { serve } from "https://deno.land/std@0.51.0/http/server.ts"

async function read(req) {
  const buf = new Uint8Array(req.contentLength)
  let bufSlice = buf
  let totRead = 0
  while (true) {
    const nread = await req.body.read(bufSlice)
    if (nread === null) break
    totRead += nread
    if (totRead >= req.contentLength) break
    bufSlice = bufSlice.subarray(nread)
  }
  return new TextDecoder('utf-8').decode(buf)
}

console.log("http://localhost:8000/")
for await (const req of serve({ port: 8000 })) {
  if (req.method === 'POST') {
    const url = await read(req)
    const res = await fetch(url)
      .catch((e) => ({ status: e.toString() }))
    req.respond({ body: `${res.status}` })
  } else {
    req.respond({ body: '200 Online' })
  }
}
