# Deploying pwise

Two domains:
- **`pwise.sixpent.com`** — the client (static SPA, uploaded via WinSCP)
- **`pwise-api.sixpent.com`** — the API (Node server on port 5000)

## 1. DNS records (at your DNS provider for `sixpent.com`)

Add two **A records** pointing at your server's public IP. If the client and API
run on the **same** box (typical), both point at the same IP.

| Type | Name / Host | Value (points to) |
| ---- | ----------- | ----------------- |
| A | `pwise`     | your server's public IP |
| A | `pwise-api` | your server's public IP |

Notes:
- Most providers want just the sub-label (`pwise`, `pwise-api`); some want the full
  name (`pwise.sixpent.com`). TTL: default is fine.
- If your DB EC2 box (the one at `18.143.58.158`) is also the web/API host, that's the IP.
- If you front the server with a load balancer/Cloudflare, use a **CNAME** to its hostname instead.
- Propagation is usually minutes; verify with `nslookup pwise.sixpent.com` / `nslookup pwise-api.sixpent.com`.

## 2. Client → WinSCP

Build (already done): `npm run build -w client` → outputs **`client/dist/`**.
Upload the **contents** of `client/dist/` (`index.html`, `assets/`, `logo.jpg`, `favicon.png`)
into the web root for `pwise.sixpent.com` (e.g. `/var/www/pwise/`). Don't upload the `dist`
folder itself; clear stale files first.

## 3. nginx (two server blocks)

```nginx
# --- Client: static SPA ---
server {
    listen 80;
    server_name pwise.sixpent.com;
    root /var/www/pwise;
    index index.html;

    # Hashed build assets never change under the same name → cache forever.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }
    # index.html points at those hashed assets → must stay fresh (ETag revalidation).
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;   # SPA fallback
    }
}

# --- API: reverse proxy to the Node server ---
server {
    listen 80;
    server_name pwise-api.sixpent.com;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Apply: `sudo nginx -t && sudo systemctl reload nginx`

## 4. HTTPS (required — the client is HTTPS, so the API must be too)
```bash
sudo certbot --nginx -d pwise.sixpent.com -d pwise-api.sixpent.com
```
Mixed content (HTTPS page → HTTP API) is blocked by browsers, so both need certs.

## 5. The API server (`pwise-api.sixpent.com`)
On the box running the Node server:
1. Get `server/`, `scripts/`, root `package.json` there; `npm install`.
2. Production root **`.env`** — critically:
   - `CLIENT_URL=https://pwise.sixpent.com`  ← lets the browser call the API cross-origin (CORS)
   - `DATABASE_URL`, `JWT_SECRET`, `SERVICE_TOKEN`, AWS vars
3. Run persistently: `pm2 start server/server.js --name pwise-api` (it listens on 5000).

## 6. S3 CORS
The bucket's `AllowedOrigins` must include the **client** origin (the browser) — it already does:
`https://pwise.sixpent.com`. The API domain is irrelevant to S3 CORS (server-to-server).

## Re-deploying after changes
Rebuild the client (`npm run build -w client`) → re-upload `client/dist/` contents.
Restart the API (`pm2 restart pwise-api`) if server code changed.
