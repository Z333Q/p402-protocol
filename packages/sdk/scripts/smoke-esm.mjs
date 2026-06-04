// Verifies the published dist works under raw Node ESM, with no bundler.
// Runs after `npm run build`. Fails the release if dist imports break.
import { P402Client, P402Error, MeterClient, OutcomesClient, scanForForbiddenContent } from '../dist/index.js';

const fail = (msg) => { console.error('SMOKE FAIL:', msg); process.exit(1); };

if (typeof P402Client !== 'function') fail('P402Client missing');
if (typeof P402Error !== 'function') fail('P402Error missing');
if (typeof MeterClient !== 'function') fail('MeterClient missing');
if (typeof OutcomesClient !== 'function') fail('OutcomesClient missing');
if (typeof scanForForbiddenContent !== 'function') fail('scanForForbiddenContent missing');

const client = new P402Client({ routerUrl: 'http://localhost' });
if (typeof client.meter?.recordEvent !== 'function') fail('client.meter.recordEvent missing');
if (typeof client.meter?.listEvents !== 'function') fail('client.meter.listEvents missing');
if (typeof client.meter?.getEvent !== 'function') fail('client.meter.getEvent missing');
if (typeof client.outcomes?.record !== 'function') fail('client.outcomes.record missing');

const err = new P402Error('NETWORK_ERROR', 'x');
if (!(err instanceof P402Error)) fail('P402Error instanceof broken');

console.log('SMOKE OK: ESM dist import + surface verified');
