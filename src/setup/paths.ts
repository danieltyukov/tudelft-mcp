import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/** The slice of the process environment that setup reads. Tests pass a fake one. */
export interface SetupEnv {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export const defaultSetupEnv = (): SetupEnv => ({ env: process.env, platform: process.platform });

/** Join with the separator of the target platform, so previews are correct across hosts. */
export function pathJoin(setup: SetupEnv, ...parts: string[]): string {
  return (setup.platform === 'win32' ? win32 : posix).join(...parts);
}

export function homeDir({ env, platform }: SetupEnv): string {
  const home = platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME;
  return home || homedir();
}

/** Per-user application data: ~/Library/Application Support, %APPDATA%, or ~/.config. */
export function appDataDir(setup: SetupEnv): string {
  const home = homeDir(setup);
  if (setup.platform === 'darwin') return pathJoin(setup, home, 'Library', 'Application Support');
  if (setup.platform === 'win32') return setup.env.APPDATA || pathJoin(setup, home, 'AppData', 'Roaming');
  return setup.env.XDG_CONFIG_HOME || pathJoin(setup, home, '.config');
}

/** ~/.config on every platform. Zed and OpenCode use it on macOS as well. */
export function dotConfigDir(setup: SetupEnv): string {
  return setup.env.XDG_CONFIG_HOME || pathJoin(setup, homeDir(setup), '.config');
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Locate an executable on PATH. Honours PATHEXT on Windows. */
export function findOnPath(name: string, setup: SetupEnv): string | undefined {
  const windows = setup.platform === 'win32';
  const dirs = (setup.env.PATH ?? '').split(windows ? ';' : ':').filter(Boolean);
  const exts = windows ? (setup.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = pathJoin(setup, dir, `${name}${ext.toLowerCase()}`);
      if (!isFile(candidate)) continue;
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not executable, keep looking
      }
    }
  }
  return undefined;
}
