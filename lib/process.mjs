import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
export function localTools() {
  try {
    return JSON.parse(
      readFileSync(fileURLToPath(new URL('../.local-tools.json', import.meta.url)), 'utf8')
    );
  } catch {
    return {};
  }
}
export function kaneCommand() {
  let binary = process.env.RESTORE_DRILL_KANE || localTools().kane;
  if (!binary && process.platform === 'win32' && process.env.APPDATA) {
    const p = join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@testmuai',
      'kane-cli',
      'bin',
      'kane-cli.cjs'
    );
    if (existsSync(p)) binary = p;
  }
  binary ||= 'kane-cli';
  return ['.js', '.cjs', '.mjs'].includes(extname(binary)) ? [process.execPath, binary] : [binary];
}
export function execute(command, args, { cwd, input, timeout = 240000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '',
      stderr = '',
      bytes = 0,
      stopped = '';
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore'
        });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop('timeout'), timeout);
    function collect(chunk, which) {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) {
        stop('output limit');
        return;
      }
      if (which === 'out') stdout += chunk;
      else stderr += chunk;
    }
    child.stdout.setEncoding('utf8').on('data', (s) => collect(s, 'out'));
    child.stderr.setEncoding('utf8').on('data', (s) => collect(s, 'err'));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + ' ' + e.message, error: e.code || e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, error: stopped || null });
    });
  });
}
