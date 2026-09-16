// Bundles the server for production. Everything from node_modules stays external (installed in
// the image), but the @foodi/shared workspace is inlined: it ships as TypeScript source with
// `.js` import specifiers, which Node can't resolve at runtime without a build step.
import { build } from 'esbuild';

const keepExternal = {
  name: 'external-except-workspace',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith('@foodi/') ? null : { path: args.path, external: true }));
  },
};

// The server, plus the one-off admin script so it can run inside the production image
// (`node dist/make-admin.js you@example.com`).
await build({
  entryPoints: { index: 'src/index.ts', 'make-admin': 'src/scripts/make-admin.ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: 'dist',
  sourcemap: true,
  plugins: [keepExternal],
  logLevel: 'info',
});
