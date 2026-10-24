# HTTP services

Small status and image proxy tools using Node.js 24+ built-in modules (no npm dependencies).

```sh
FETCH_ALLOWED_ORIGINS=https://example.com node status.js
# Or on a separate port:
FETCH_ALLOWED_ORIGINS=https://example.com PORT=8001 node img.js
```

Send a URL as the POST body. Both tools listen only on 127.0.0.1. The allowlist
is empty by default, so no upstream request is permitted until configured.
Set comma-separated exact trusted origins; ports and protocols must match.
Configure domains you control or trust, rather than user-owned domains.

All DNS answers must be public addresses. Connections pin an already validated
IP while preserving the hostname and TLS certificate checks. Redirects are
limited to three and revalidated against both the allowlist and DNS policy.
Requests have a five-second total timeout, a 2 KiB input limit and a 2 MiB
upstream limit. The image tool accepts raster image content types only.

The former Deno 0.x scripts are replaced by Node's supported HTTP/DNS APIs.
Before exposing these local tools, add authentication and traffic limits at
your reverse proxy. They do not enable browser CORS access.

Run the regression suite with `node --test`. MIT, see LICENSE.
