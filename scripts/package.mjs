import { packager } from '@electron/packager';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const appPaths = await packager({
  dir: root,
  name: 'Sound Fossil',
  appVersion: pkg.version,
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'release'),
  overwrite: true,
  asar: true,
  prune: true,
  icon: path.join(root, 'assets', 'icon.ico'),
  ignore: [
    /^\/\.git($|\/)/,
    /^\/tests($|\/)/,
    /^\/scripts($|\/)/,
    /^\/release($|\/)/,
    /^\/artifacts($|\/)/,
    /^\/dist\/.*\.map$/,
    /^\/README\.md$/,
  ],
  win32metadata: {
    CompanyName: 'Sound Fossil contributors',
    FileDescription: 'Sound Fossil — auditory fossil studio',
    ProductName: 'Sound Fossil',
    InternalName: 'SoundFossil',
    OriginalFilename: 'Sound Fossil.exe',
  },
});

for (const appPath of appPaths) {
  console.log(`Package ready: ${appPath}`);
}
