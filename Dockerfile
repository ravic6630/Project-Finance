# Sampada — single-image deploy (API serves the built web on one port).
FROM node:22-bookworm-slim

# Python is needed for the CAS parser sidecar (casparser). On Debian bookworm
# this is Python 3.11, so casparser >= 1.x installs (stocks + mutual funds).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# CAS parser virtualenv (kept outside /app so app code changes don't bust it).
ENV CAS_PYTHON=/opt/cas-venv/bin/python
RUN python3 -m venv /opt/cas-venv \
  && /opt/cas-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/cas-venv/bin/pip install --no-cache-dir casparser

WORKDIR /app

COPY . .

# Install from the COMMITTED lockfile. This used to delete the lockfile and run
# a fresh `npm install`, which dated from npm 6/7 — back then a macOS-generated
# lockfile omitted Linux binaries and broke `vite build`. lockfileVersion 3
# records every platform's optional deps (@rollup/rollup-linux-x64-gnu,
# @esbuild/linux-x64, @libsql/linux-x64-gnu are all in ours), so re-resolving
# ~600 packages from scratch in the builder bought nothing and was the step that
# failed. `npm ci` is deterministic, quicker and needs far less memory.
#
# --include=dev is REQUIRED, not cosmetic: the host injects NODE_ENV=production
# into the build, which makes npm skip devDependencies — and vite lives there,
# so `npm run build` would fail with "vite: not found".
#
# The fallback keeps a deploy alive if package.json and the lockfile ever drift
# (npm ci refuses to guess); the build then just costs a resolution pass.
RUN npm ci --include=dev || npm install --include=dev
RUN npm run build
# The bundle is built; drop build-only packages so the runtime image stays small
# (the API only needs server/ dependencies at run time).
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# `npm start` runs the API in production; it serves web/dist on $PORT.
CMD ["npm", "start"]
