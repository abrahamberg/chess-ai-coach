import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: '0.0.0.0' }).catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
}
