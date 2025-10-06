# Interceptor v1 — PostgreSQL Wire Protocol Proxy

A simple PostgreSQL wire-protocol proxy that prints messages flowing between client and server (Startup/Authentication and Extended Query protocol messages). Designed for debugging and learning the protocol.

- Forwards bytes unmodified — no TLS termination.
- Parses and logs: Startup/SSL negotiation, Query/Parse/Bind/Execute/Sync, RowDescription/DataRow/CommandComplete, errors/notices.
- Built-in modern admin web portal to view logs live (SSE-based) at http://127.0.0.1:8080 by default.

## How SSL/TLS affects logging

- Clients typically begin with an SSLRequest. The server replies with a single byte: `S` (accept TLS) or `N` (deny).
- If TLS is accepted, all subsequent traffic is encrypted. Since this proxy doesn’t terminate TLS, it cannot parse or log those messages.
- To see full message logs, connect with SSL disabled (e.g., `sslmode=disable`) or implement TLS termination in the proxy (advanced).

## Prerequisites

- Node.js 16+
- Docker (optional; repo includes a `docker-compose.yml` for Postgres)

## Setup

1. Start Postgres in Docker (optional):

   - Exposes Postgres on host port `5433` to avoid conflicts
   - Creates DB `testdb` with user `testuser` and password `testpass@123`

2. Start the proxy:
   - Listens on `5432` and forwards to `127.0.0.1:5433` by default.

### Environment variables

- `PROXY_PORT` (default `5432`) — Port the proxy listens on
- `PG_HOST` (default `127.0.0.1`) — Upstream Postgres host
- `PG_PORT` (default `5433`) — Upstream Postgres port
- `ADMIN_PORT` (default `8080`) — Admin web portal port

## Usage

- With psql (plaintext for full logs):
  - `psql "postgresql://testuser:testpass%40123@127.0.0.1:5432/testdb?sslmode=disable"`
- With DataGrip:
  - Host: `127.0.0.1`, Port: `5432`
  - SSL Mode: `disable` (or set `sslmode=disable` in Advanced)

Perform queries and watch the proxy output log incoming/outgoing protocol messages.

Open the admin portal to view structured logs:

- http://127.0.0.1:8080 (or the port you set in `ADMIN_PORT`)

## Development

- Start proxy:
  - `npm start`
- Lint/format: use your preferred tools; code is plain CommonJS.

## Advanced: TLS termination (not implemented)

To log messages when TLS is required, you’d need to accept TLS from the client using a certificate the client trusts (e.g., a custom CA), then proxy to Postgres (TLS or plaintext) and parse frames in the middle. That requires managing keys/certs and is outside this minimal proxy’s scope.
