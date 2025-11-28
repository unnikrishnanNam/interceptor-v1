# Interceptor v1 — PostgreSQL Wire Protocol Proxy (Optimized)

A high-performance PostgreSQL wire-protocol proxy that intercepts and logs messages flowing between client and server. Features real-time query blocking with an admin approval workflow and a modern web UI.

## Features

- ✅ **Zero-copy forwarding** — Forwards bytes unmodified (no TLS termination)
- 🔍 **Protocol parsing** — Startup/Authentication, Extended Query protocol (Parse/Bind/Execute), Simple Query
- 🚫 **Query blocking** — Intercept queries for manual approval/rejection before execution
- 📊 **Real-time admin UI** — Modern web portal with SSE-based live logs at http://127.0.0.1:8080
- ⚡ **Performance optimizations** — Buffer pooling, reduced allocations, optimized parsing

## Optimizations (v1.1.0)

### Backend

- **Parser**: Cached buffer references, eliminated redundant string conversions, reduced closure allocations
- **Connection handling**: Fixed duplicate socket close events, streamlined TLS passthrough detection
- **Admin server**: Added request body size limits (1MB), cached MIME types, improved SSE client cleanup
- **Buffer operations**: Using `allocUnsafe` where safe, reduced `Buffer.concat` calls

### Frontend

- **Debounced search** (300ms) to reduce unnecessary re-renders
- **DocumentFragment batching** for efficient DOM updates
- **Removed duplicate API calls** — SSE events trigger refreshes automatically

### Code quality

- Removed dead code (duplicate `proxy.js`, unused parameters)
- Eliminated unnecessary try-catch wrappers
- Streamlined error handling paths

## How SSL/TLS affects logging

- Clients typically begin with an SSLRequest. The server replies with a single byte: `S` (accept TLS) or `N` (deny).
- If TLS is accepted, all subsequent traffic is encrypted. Since this proxy doesn’t terminate TLS, it cannot parse or log those messages.
- To see full message logs, connect with SSL disabled (e.g., `sslmode=disable`) or implement TLS termination in the proxy (advanced).

## Prerequisites

- Node.js 16+
- Docker (optional; repo includes a `docker-compose.yml` for Postgres)

## Setup

1. **Start Postgres in Docker** (optional):

   ```bash
   npm run docker:up
   ```

   - Exposes Postgres on host port `5433` to avoid conflicts
   - Creates DB `testdb` with user `testuser` and password `testpass@123`

2. **Start the proxy**:

   ```bash
   npm start
   ```

   - Listens on `5432` and forwards to `127.0.0.1:5433` by default

3. **Open admin UI**: http://127.0.0.1:8080

### Environment variables

- `PROXY_PORT` (default `5432`) — Port the proxy listens on
- `PG_HOST` (default `127.0.0.1`) — Upstream Postgres host
- `PG_PORT` (default `5433`) — Upstream Postgres port
- `ADMIN_PORT` (default `8080`) — Admin web portal port

## Usage

- **With psql** (plaintext for full logs):

  ```bash
  psql "postgresql://testuser:testpass%40123@127.0.0.1:5432/testdb?sslmode=disable"
  ```

- **With DataGrip**:
  - Host: `127.0.0.1`, Port: `5432`
  - SSL Mode: `disable` (or set `sslmode=disable` in Advanced)

Perform queries and watch the proxy output log incoming/outgoing protocol messages.

**Admin portal**: http://127.0.0.1:8080 (or the port you set in `ADMIN_PORT`)

- View live logs with filtering and search (debounced)
- Approve/reject blocked queries in real-time

## Development

```bash
# Start proxy
npm start

# Start with debugging
npm run dev

# Docker management
npm run docker:up      # Start Postgres container
npm run docker:down    # Stop and remove containers
npm run docker:logs    # View Postgres logs
```

## Performance Tips

- For **high-throughput scenarios**, consider:

  - Reducing console logging (comment out `debugLog` calls in production)
  - Increasing Node.js memory limit: `node --max-old-space-size=4096 src/index.js`
  - Using `NODE_ENV=production` to disable verbose logging

- **Memory usage**: The proxy maintains in-memory logs and blocked queries. For long-running sessions, implement periodic cleanup or log rotation.

## Advanced: TLS termination (not implemented)

To log messages when TLS is required, you’d need to accept TLS from the client using a certificate the client trusts (e.g., a custom CA), then proxy to Postgres (TLS or plaintext) and parse frames in the middle. That requires managing keys/certs and is outside this minimal proxy’s scope.
