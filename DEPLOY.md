# Deploying Sampada

Sampada is a Node app (Express) that **serves the built React site and the API on one port**, uses
**SQLite** (a single file on disk), and shells out to **Python** for CAS parsing. So it needs a host
that runs a long-lived Node+Python process with a **persistent disk** — i.e. a **VPS** or a
**container PaaS** (Render, Railway, Fly.io). Plain shared/static hosting (e.g. Hostinger hPanel
static) **won't** run it.

The repo ships a `Dockerfile` (Node 22 + Python 3.11 + casparser) so both routes below "just build".

> ⚠️ Before charging real money or handling others' financial data, confirm DPDP-Act/SEBI
> obligations and publish a privacy policy + terms.

---

## 1. Prepare env

```bash
cp .env.production.example .env.production   # then fill in values
```
Set at least `JWT_SECRET` and `ADMIN_EMAILS`. Point `BROKER_REDIRECT_BASE` at your public URL
(`https://vyomarafarms.com`). Add SMTP / broker / Razorpay keys when you want those features live.

---

## Option A — VPS with Docker (e.g. Hostinger VPS, DigitalOcean, EC2)

```bash
# on the server (Ubuntu)
curl -fsSL https://get.docker.com | sh           # installs Docker + compose plugin
git clone <your-repo>  sampada && cd sampada      # or scp the folder up
cp .env.production.example .env.production && nano .env.production
docker compose up -d --build                      # builds + runs on :8080
docker compose logs -f                            # check it booted
```

Put it behind a domain with HTTPS using nginx + certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
# /etc/nginx/sites-available/sampada  →  proxy_pass http://127.0.0.1:8080;  server_name vyomarafarms.com;
sudo ln -s /etc/nginx/sites-available/sampada /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d vyomarafarms.com          # free SSL
```

Point DNS: an **A record** for `vyomarafarms.com` → your VPS IP. Updates: `git pull && docker compose up -d --build`.

---

## Option B — Container PaaS (Render / Railway) — easiest

1. Push this repo to GitHub.
2. Create a new **Web Service** from the repo; it auto-detects the `Dockerfile`.
3. Add environment variables (from `.env.production.example`).
4. Add a **persistent disk** mounted at `/app/server/data` (so the SQLite DB + JWT secret survive
   redeploys). **Without this, data resets on every deploy.**
5. Add the custom domain `vyomarafarms.com` (the platform gives you a CNAME/A record + free SSL).

---

## After it's live

- Set the broker app **redirect URLs** to `https://vyomarafarms.com/broker/<broker>/callback`, and
  set `BROKER_REDIRECT_BASE=https://vyomarafarms.com`.
- Point the Razorpay **webhook** to `https://vyomarafarms.com/api/billing/webhook`.
- The **daily email** only fires while the server is running (true on a VPS/PaaS).
- **Backups** = copy the `server/data` volume (it's just `sampada.db`).
