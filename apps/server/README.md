Wealthfolio legacy Rust server

Overview
- This crate contains the legacy Axum HTTP API implementation retained during the
  TypeScript/Bun backend migration as a parity reference and compatibility
  source.
- Current local web, Docker, standalone prebuild, and packaged Electron runtime
  paths use `apps/backend` instead of this crate.
- The Rust server still uses the shared `crates/*` business logic, repositories,
  and migrations when it is run explicitly for reference checks.

Run locally for reference checks
- From the repo root:
  - `cargo run --manifest-path apps/server/Cargo.toml`

Docker image
- Docker runtime images now launch the Bun TypeScript backend. Use the root
  `README.md` Docker instructions for current self-hosted/web runtime usage.

Key environment variables for the legacy Rust server
- `WF_LISTEN_ADDR`: Bind address, default `127.0.0.1:8080`.
- `WF_DB_PATH`: Path to the SQLite database file (or a directory; if a directory is provided, `app.db` is used inside it). Example: `./db/app.db`.
- `WF_CORS_ALLOW_ORIGINS`: Comma-separated list of allowed origins for CORS. Example: `http://localhost:1420`.
- `WF_REQUEST_TIMEOUT_MS`: Request timeout in milliseconds. Default `30000`.
- `WF_STATIC_DIR`: Directory to serve static assets from (the web build output). Default `dist`.
- `WF_SECRET_KEY`: Required 32-byte key used to encrypt secrets at rest and sign JWTs. Must decode to exactly 32 bytes.
  Can be provided as:
  - Base64-encoded string (recommended): Generate with `openssl rand -base64 32` or `head -c 32 /dev/urandom | base64`
  - 32-byte ASCII string: Must be exactly 32 characters (less secure if contains only printable characters)
  Example: `WF_SECRET_KEY=$(openssl rand -base64 32)`.
- `WF_AUTH_PASSWORD_HASH`: Enables password-only authentication for web mode when set to an Argon2id PHC string.
  Generate via online tools like [argon2.online](https://argon2.online/) or the CLI (`argon2-utils` package):
  ```bash
  printf 'your-password' | argon2 yoursalt16chars! -id -e
  ```
  The first argument is the **salt** (use 16+ characters); the password is read from stdin.
  Use `printf` instead of `echo -n` to avoid hidden newline issues.
  For Docker Compose `.env`/`--env-file`, single-quote the value or double every `$`;
  for YAML inline values, double every `$` in the hash (`$$argon2id$$...`).
  When unset, authentication is disabled.
- `WF_AUTH_TOKEN_TTL_MINUTES`: Optional JWT access token lifetime (minutes).
  Defaults to `60`.
- `WF_SECRET_BACKEND`: Optional secret-store backend. Use `file` for
  web/self-hosted reference runs (default) or `keyring` for legacy desktop
  sidecar builds compiled with the `keyring-backend` Cargo feature.
- `WF_SECRET_FILE`: Optional override for where encrypted file-backed secrets
  are stored. Defaults to `<data-root>/secrets.json`. Ignored when
  `WF_SECRET_BACKEND=keyring`.

Notes
- The server also honors `DATABASE_URL`; when running in this workspace,
  `WF_DB_PATH` is preferred and propagated to `DATABASE_URL` internally so the
  core layer uses the expected path.
- Database migrations are embedded and applied automatically on startup.
- Secrets in web/server mode are stored in an encrypted JSON file derived from
  the database directory using `WF_SECRET_KEY`; legacy desktop sidecars can use
  the OS keyring backend.
