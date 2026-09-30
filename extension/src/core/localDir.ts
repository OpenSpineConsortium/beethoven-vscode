// The folder on this computer that holds the license key, the Wayne State sign-in record, the accepted
// terms and the CLI's settings. No 'vscode' import.
//
// New installs use ~/.beethoven-local. A computer that ran Ashley for VS Code (3.0.0 and earlier) has
// ~/.ashley-local, and that folder stays in use as long as no ~/.beethoven-local exists: the key and
// the accepted terms already there carry over, and Ashley and Beethoven see one key while both are
// installed. Nothing is moved or copied.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const LOCAL_DIR_NAME = '.beethoven-local';
/** the folder's name before the rename, still used where it exists (see above) */
export const OLD_LOCAL_DIR_NAME = '.ashley-local';

/** The folder without any override: ~/.beethoven-local, or ~/.ashley-local on a computer that already has it. */
export function localDir(home = os.homedir()): string {
  const now = path.join(home, LOCAL_DIR_NAME);
  const old = path.join(home, OLD_LOCAL_DIR_NAME);
  return !fs.existsSync(now) && fs.existsSync(old) ? old : now;
}

/** The license and terms folder: BEETHOVEN_LICENSE_DIR, then ASHLEY_LICENSE_DIR (its name before the rename), then localDir(). */
export function licenseDir(): string {
  return process.env.BEETHOVEN_LICENSE_DIR || process.env.ASHLEY_LICENSE_DIR || localDir();
}
