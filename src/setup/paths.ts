import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The slice of the process environment that setup reads. Tests pass a fake one. */
export interface SetupEnv {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export const defaultSetupEnv = (): SetupEnv => ({ env: process.env, platform: process.platform });

export function homeDir({ env, platform }: SetupEnv): string {
  const home = platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME;
  return home || homedir();
}

/** Per-user application data: ~/Library/Application Support, %APPDATA%, or ~/.config. */
export function appDataDir(setup: SetupEnv): string {
  const home = homeDir(setup);
  if (setup.platform === 'darwin') return join(home, 'Library', 'Application Support');
  if (setup.platform === 'win32') return setup.env.APPDATA || join(home, 'AppData', 'Roaming');
  return setup.env.XDG_CONFIG_HOME || join(home, '.config');
}

/** ~/.config on every platform. Zed and OpenCode use it on macOS as well. */
export function dotConfigDir(setup: SetupEnv): string {
  return setup.env.XDG_CONFIG_HOME || join(homeDir(setup), '.config');
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
      const candidate = join(dir, `${name}${ext.toLowerCase()}`);
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
