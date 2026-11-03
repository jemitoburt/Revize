# Deploying Revize with Dokploy

Use `docker-compose.dokploy.yml` as the Compose file in Dokploy. The regular
`docker-compose.yml` is intended for a standalone host where Caddy can bind
ports 80 and 443. Dokploy's Traefik owns those public ports, so the Dokploy
variant leaves them unpublished and connects only the web service to
`dokploy-network`.

In the Dokploy Compose environment, set:

- `POSTGRES_PASSWORD`: a long random database password. It is passed to the API
  separately from the database URL, so URL-reserved characters are supported.
- `TRUSTED_ORIGINS`: the exact HTTPS origin, for example
  `https://revize.example.com` (no trailing slash).

Set `ADMIN_PASSWORD` to choose the initial administrator password. If it is
empty, the API generates one on first startup and writes it once to the API
logs. Optionally set `ADMIN_EMAIL`, `ORG_NAME`, `SEED_DEMO`, and `LOG_LEVEL`.
Keep passwords private and do not commit them to the repository.

After deployment, create a Dokploy domain for service `web` on port `80`,
enable HTTPS with Let's Encrypt, and use the same HTTPS origin in
`TRUSTED_ORIGINS`. Dokploy/Traefik terminates TLS and forwards traffic to
Caddy over the internal network. Do not publish host ports for `web`.

The database, uploaded files, and database password persist in named Docker
volumes or Dokploy environment variables. Back up the database and `files`
volume before upgrading or moving the project.
