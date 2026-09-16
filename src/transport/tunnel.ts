import { spawn, type ChildProcess } from 'node:child_process';
import type { Logger } from '../context.js';
import { TudelftError } from '../errors.js';
import { defaultSetupEnv, findOnPath } from '../setup/paths.js';
import { sleep } from '../util/paging.js';

export interface Tunnel {
  provider: 'cloudflared' | 'ngrok';
  url: string;
  close(): void;
}

const TUNNEL_TIMEOUT_MS = 60_000;

function start(binary: string, args: string[]): ChildProcess {
  return spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function failure(message: string): TudelftError {
  return new TudelftError('UNAVAILABLE', message);
}

/** cloudflared prints the quick tunnel hostname on stderr shortly after starting. */
function cloudflared(binary: string, port: number): Promise<Tunnel> {
  const child = start(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`]);
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error?: TudelftError, url?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (url) resolve({ provider: 'cloudflared', url, close: () => child.kill() });
      else {
        child.kill();
        reject(error);
      }
    };
    const timer = setTimeout(
      () => finish(failure('cloudflared did not print a public URL within 60 seconds.')),
      TUNNEL_TIMEOUT_MS,
    );
    const onData = (chunk: Buffer): void => {
      if (settled) return;
      output = (output + chunk.toString('utf8')).slice(-8192);
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(output);
      if (match) finish(undefined, match[0]);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => finish(failure(`cloudflared could not be started: ${error.message}`)));
    child.on('exit', (code) => finish(failure(`cloudflared exited early (code ${code ?? 'unknown'}).`)));
  });
}

interface NgrokTunnels {
  tunnels?: Array<{ public_url?: string; config?: { addr?: string } }>;
}

/** ngrok exposes its tunnels on a local API; poll it until ours shows up. */
async function ngrok(binary: string, port: number): Promise<Tunnel> {
  const child = start(binary, ['http', String(port), '--log', 'stdout', '--log-format', 'json']);
  child.stdout?.resume();
  child.stderr?.resume();
  let exited: number | null | undefined;
  child.on('exit', (code) => {
    exited = code;
  });
  const deadline = Date.now() + TUNNEL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited !== undefined) throw failure(`ngrok exited early (code ${exited ?? 'unknown'}).`);
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        const data = (await response.json()) as NgrokTunnels;
        const match = data.tunnels?.find(
          (tunnel) =>
            tunnel.public_url?.startsWith('https://') && (tunnel.config?.addr ?? '').endsWith(`:${port}`),
        );
        if (match?.public_url) return { provider: 'ngrok', url: match.public_url, close: () => child.kill() };
      }
    } catch {
      // the API is not up yet
    }
    await sleep(500);
  }
  child.kill();
  throw failure('ngrok did not report a public URL within 60 seconds.');
}

/** Expose the local port through cloudflared (preferred) or ngrok. */
export async function openTunnel(port: number, log: Logger): Promise<Tunnel> {
  const setup = defaultSetupEnv();
  const cloudflaredBinary = findOnPath('cloudflared', setup);
  if (cloudflaredBinary) {
    log('Starting a cloudflared quick tunnel...');
    return cloudflared(cloudflaredBinary, port);
  }
  const ngrokBinary = findOnPath('ngrok', setup);
  if (ngrokBinary) {
    log('Starting an ngrok tunnel...');
    return ngrok(ngrokBinary, port);
  }
  throw failure(
    'Neither cloudflared nor ngrok was found on PATH. Install one of them: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ or https://ngrok.com/download',
  );
}
