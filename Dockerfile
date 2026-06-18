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

# Copy everything, then do a CLEAN install so Linux-native binaries (esbuild,
# rollup) resolve correctly. Dropping the host lockfile avoids the cross-platform
# optional-dependency issue that makes `vite build` fail when the lockfile was
# generated on a different OS (e.g. macOS).
COPY . .
RUN rm -f package-lock.json && npm install
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# `npm start` runs the API in production; it serves web/dist on $PORT.
CMD ["npm", "start"]
