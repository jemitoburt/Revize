# Provoz – nasazení na server, zálohy, aktualizace

Celý systém běží v Dockeru na jednom Linuxovém serveru. Tvoří ho tři kontejnery: `web` (Caddy,
HTTPS), `api` (Node.js) a `db` (PostgreSQL 16). Nepotřebuje žádný placený účet ani službu.

## Požadavky

- Linux, x86-64 nebo ARM64 (ne 32bitový ARM).
- 2 vCPU a 4 GB RAM (od PDF protokolů v M7 poběží na serveru Chromium).
- Disk 40 GB a k tomu místo na fotky, zhruba 0,5 MB na fotku.
- Docker Engine s Docker Compose v2 a git.
- Adresa (sub)domény s platným HTTPS. Bez něj iPad nepustí kameru.

## Nasazení

```sh
git clone https://github.com/vitekdynka-debug/Revize.git
cd Revize
cp .env.example .env
```

V `.env` nastavte:

| Proměnná            | Hodnota                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD` | dlouhé náhodné heslo (`openssl rand -base64 24`)                                     |
| `ADMIN_EMAIL`       | e-mail prvního administrátora                                                        |
| `ADMIN_PASSWORD`    | jeho heslo (aspoň 10 znaků). Platí jen pro první spuštění, pak ho změňte v aplikaci. |
| `ORG_NAME`          | název vaší firmy                                                                     |
| `SEED_DEMO`         | `false` pro ostrý provoz (`true` vloží ukázková data)                                |
| `SITE_ADDRESS`      | podle varianty níže                                                                  |

### Varianta A – na serveru nic jiného na portech 80/443 neběží

- `SITE_ADDRESS=revize.vase-domena.cz` a DNS záznam této domény musí mířit na server.
- Porty 80 a 443 musí být dostupné z internetu. Caddy si sám vyřídí certifikát Let's Encrypt
  a obnovuje ho.

### Varianta B – na serveru už běží reverzní proxy (nginx, Traefik, Caddy…)

- `.env`:

  ```sh
  SITE_ADDRESS=:80
  HTTP_PORT=8080      # nebo jiný volný port
  HTTPS_PORT=8443     # nepoužívá se, jen aby nekolidoval s proxy
  COOKIE_SECURE=true  # prohlížeč vidí HTTPS
  ```

- Proxy terminuje HTTPS pro `revize.vase-domena.cz`, přeposílá vše na `http://127.0.0.1:8080`
  a předává hlavičky `Host` a `X-Forwarded-*`. Limit velikosti požadavku nastavte aspoň
  **20 MB** (import a fotky).
- Příklad pro nginx:

  ```nginx
  server {
    server_name revize.vase-domena.cz;
    listen 443 ssl;   # certifikát podle vaší konfigurace
    client_max_body_size 20m;
    location / {
      proxy_pass http://127.0.0.1:8080;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
  }
  ```

### Spuštění a kontrola

```sh
docker compose up -d --build
docker compose ps                     # db, api a web: healthy
scripts/smoke-test.sh https://revize.vase-domena.cz admin@firma.cz '<heslo>'
```

- Kancelář je na `https://<adresa>/`, terén na `https://<adresa>/teren`, test skeneru na
  `https://<adresa>/spike/` a dokumentace API na `https://<adresa>/api/docs`.
- Technici: v kanceláři **Uživatelé → Nový uživatel** s rolí Technik. Na iPadu otevřete adresu
  v Safari a zvolte **Sdílet → Přidat na plochu**.

## Zálohy

`scripts/backup.sh [adresář]` uloží výpis databáze (`db.dump`), všechny soubory (`files.tar.gz`)
a kontrolní součty (`manifest.txt`) do `adresář/revize-<datum-čas>/`. Zálohy starší než
`KEEP_DAYS` (výchozí 30 dní) maže.

Denně ve 2:15 přes cron (`crontab -e` uživatele, který smí spouštět Docker):

```cron
15 2 * * * cd /opt/Revize && scripts/backup.sh /srv/zalohy/revize >> /var/log/revize-backup.log 2>&1
```

Adresář záloh by měl ležet **na jiném disku nebo stroji**. Stačí ho jednou denně zkopírovat
(rsync) například na NAS:

```cron
45 2 * * * rsync -a --delete /srv/zalohy/revize/ nas:/share/zalohy/revize/
```

### Obnova

```sh
scripts/restore.sh /srv/zalohy/revize/revize-20261103-021500
```

Skript ověří kontrolní součty, zastaví API, nahradí databázi i soubory zálohou a systém znovu
spustí. Všechna současná data přepíše, proto se ptá na potvrzení.

**Test obnovy:** `scripts/test-restore.sh` založí data s fotkou, zazálohuje je, všechno smaže,
obnoví a porovná. Běží automaticky v CI. Na ostrém serveru ho nespouštějte, protože data maže. Na
zkušební kopii ho spusťte před velkou aktualizací.

## Aktualizace

```sh
cd /opt/Revize
scripts/backup.sh /srv/zalohy/revize     # vždy před aktualizací
git pull
docker compose up -d --build             # migrace databáze proběhnou samy
scripts/smoke-test.sh https://<adresa> <admin-email> '<heslo>'
```

## Běžná správa

| Úkol                                   | Příkaz                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Stav služeb                            | `docker compose ps`                                                                                                             |
| Logy                                   | `docker compose logs -f api`                                                                                                    |
| Zastavení (data zůstanou)              | `docker compose down`                                                                                                           |
| Nový uživatel / obnova přístupu admina | `docker compose exec api node dist/cli/create-user.js --email x@firma.cz --name "Jméno" --role admin --password "dlouhé-heslo"` |

Data jsou ve svazcích Dockeru: `revize_db-data` (databáze), `revize_files` (fotky) a
`revize_caddy-data` (certifikáty).

> **Pozor:** `docker compose down -v` smaže i svazky, tedy všechna data.

## Vývoj

```sh
pnpm install
pnpm db:test                       # PostgreSQL v Dockeru pro testy a vývoj (port 5432)
cp apps/api/.env.example apps/api/.env
pnpm api:dev                       # API na http://localhost:3000, dokumentace /api/docs
pnpm --filter @revize/web dev      # kancelář na http://localhost:5173 (API přes proxy)
pnpm check                         # formát, lint, typy, všechny testy (vyžaduje db:test)
```
