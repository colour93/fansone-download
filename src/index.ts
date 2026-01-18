import { bootstrap } from './bootstrap.js';
import { runCli } from './cli.js';
(async () => {
    await bootstrap();
    await runCli();
})()