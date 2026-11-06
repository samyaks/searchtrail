// Writes src/mocks/examples.json: every example in contracts/openapi.yaml, keyed by
// operationId, then "request" or the response status, then the example name.
// MSW handlers serve these, so mocked data is exactly the contract's examples.
// Run through `npm run gen:api` (scripts/codegen.sh). Never edit the output by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const spec = parse(readFileSync(resolve(here, '../../contracts/openapi.yaml'), 'utf8'), { maxAliasCount: -1 });

const resolveRef = (node) => {
  while (node && node.$ref) {
    node = node.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((n, key) => n[key], spec);
  }
  return node;
};

const out = {};
const methods = ['get', 'put', 'post', 'patch', 'delete'];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of methods) {
    const op = item[method];
    if (!op) continue;
    const entry = { method: method.toUpperCase(), path, examples: {} };
    const bodies = [['request', op.requestBody], ...Object.entries(op.responses ?? {})];
    for (const [key, body] of bodies) {
      const content = resolveRef(body)?.content ?? {};
      const media = content['application/json'] ?? content['text/csv'];
      if (!media?.examples) continue;
      entry.examples[key] = Object.fromEntries(
        Object.entries(media.examples).map(([name, ex]) => [name, resolveRef(ex).value]),
      );
    }
    out[op.operationId] = entry;
  }
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(resolve(here, '../src/mocks/examples.json'), JSON.stringify(sorted, null, 2) + '\n');
console.log(`Wrote ${Object.keys(sorted).length} operations to src/mocks/examples.json`);
