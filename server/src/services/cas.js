import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAS_DIR = join(__dirname, '..', '..', 'tools', 'cas');
const SCRIPT = join(CAS_DIR, 'parse_cas.py');
const VENV_PYTHON = join(CAS_DIR, '.venv', 'bin', 'python');

// Resolve the Python interpreter: explicit env > project venv > system python3.
function pythonPath() {
  if (process.env.CAS_PYTHON) return process.env.CAS_PYTHON;
  if (existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return 'python3';
}

// CAS import is available only if the sidecar exists and a venv was set up.
export function casAvailable() {
  return existsSync(SCRIPT) && (existsSync(VENV_PYTHON) || !!process.env.CAS_PYTHON);
}

function runSidecar(args) {
  return new Promise((resolve) => {
    execFile(
      pythonPath(),
      [SCRIPT, ...args],
      { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (stdout && stdout.trim()) {
          try {
            return resolve(JSON.parse(stdout));
          } catch {
            /* fall through to error */
          }
        }
        resolve({
          ok: false,
          errorType: err?.code === 'ENOENT' ? 'not_installed' : 'sidecar_error',
          error: err?.message || 'Parser produced no output',
        });
      }
    );
  });
}

// Parse a CAS PDF buffer. Writes to a temp file (casparser needs a path), runs
// the sidecar, and always resolves to the normalized contract (never throws).
export async function parseCasBuffer(buffer, password = '') {
  const dir = mkdtempSync(join(tmpdir(), 'sampada-cas-'));
  const file = join(dir, 'statement.pdf');
  try {
    writeFileSync(file, buffer);
    return await runSidecar([file, '--password', password || '']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function selfTest() {
  return runSidecar(['--self-test']);
}
