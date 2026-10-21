// Run several sweep steps at once, each on its own phone(s) and host ports. Every output line is
// prefixed with the step's tag so the interleaved log stays readable.

import { spawn } from 'node:child_process';

function prefixLines(stream, tag, out) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) out.write(`[${tag}] ${line}\n`);
  });
  stream.on('end', () => {
    if (pending) out.write(`[${tag}] ${pending}\n`);
  });
}

/**
 * steps: [{ tag, command, args, env, cwd, timeoutMs }]. Resolves to [{ tag, ok, status, error }]
 * in the same order once every step has exited.
 */
export function runParallel(steps) {
  return Promise.all(steps.map((step) => new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: step.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    prefixLines(child.stdout, step.tag, process.stdout);
    prefixLines(child.stderr, step.tag, process.stderr);
    const timer = step.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), step.timeoutMs) : null;
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ tag: step.tag, ok: false, status: null, error: error.message });
    });
    child.on('close', (status, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ tag: step.tag, ok: status === 0, status, error: signal ? `killed by ${signal}` : '' });
    });
  })));
}
