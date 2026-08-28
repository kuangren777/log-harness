import { defineConfig } from 'tsdown'

/**
 * This package ships THREE entries: the plugin (`index`), its invariant
 * companion (`invariant`), and the `sci-ssh-doctor` CLI (`bin`) named by
 * package.json `bin`. The root tsdown builds only index/invariant/startup, so
 * this override adds `lib/types/bin.js`. Declarations come from `tsc -b`
 * (`dts: false`), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
