#!/usr/bin/env -S deno run --allow-net --allow-read=img.html --unstable
import { serve } from "https://deno.land/std@0.52.0/http/server.ts"
import { readFileStrSync } from "https://deno.land/std@0.52.0/fs/mod.ts";

const html = readFileStrSync('img.html')

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

async function base64Fetch(request) {
  const text = await read(request)

  const headers = {
    'Accept': '*/*',
  }
  let type = 'text/plain'

  const status = await fetch(new Request(text), {headers})
   .then(e => {
      type = e.headers.get("Content-Type")
      return e.arrayBuffer()
    })
    .then(buffer => btoa(
      [].slice.call(new Uint8Array(buffer))
      .reduce((p,c) => p + String.fromCharCode(c), '')
    ))
    .then(e => 'data:' + type + ';base64,' + e.toString())
    .catch(e => e.toString())

  return status
}

console.log("http://localhost:8000/")
for await (const req of serve({ port: 8000 })) {
  if (req.method === 'POST') {
    req.respond({ body: await base64Fetch(req) })
  } else {
    req.respond({ body: html })
  }
}
