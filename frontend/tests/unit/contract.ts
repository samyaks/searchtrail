// Validates mock responses against contracts/openapi.yaml itself (not against hand-copied types), so a mock
// that drifts from the contract fails a test. OpenAPI 3.1 schemas are JSON Schema 2020-12.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const spec: Json = parse(readFileSync(resolve(__dirname, '../../../contracts/openapi.yaml'), 'utf8'), { maxAliasCount: -1 });

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'contract', components: spec.components });

function resolveRef<T extends Json>(node: T): Json {
  let current: Json = node;
  while (current?.$ref) {
    current = (current.$ref as string)
      .replace(/^#\//, '')
      .split('/')
      .reduce<Json>((n, key) => n[key], spec);
  }
  return current;
}

/** Every operation in the contract: operationId -> method, path (as in the contract) and the operation object. */
export const operations: Record<string, { method: string; path: string; operation: Json }> = {};
for (const [path, item] of Object.entries<Json>(spec.paths)) {
  for (const method of ['get', 'put', 'post', 'patch', 'delete']) {
    if (item[method]) operations[item[method].operationId] = { method: method.toUpperCase(), path, operation: item[method] };
  }
}

function schemaFor(media: Json | undefined) {
  const schema = media?.schema;
  if (!schema) return undefined;
  // Local refs ("#/components/...") point into the document registered as "contract".
  const rewritten = JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"contract#/components/'));
  return ajv.compile(rewritten);
}

const cache = new Map<string, ReturnType<typeof schemaFor>>();
function validator(key: string, media: Json | undefined) {
  if (!cache.has(key)) cache.set(key, schemaFor(media));
  return cache.get(key);
}

/** Problems with a JSON response body against the contract (an empty list means it conforms). */
export function responseProblems(operationId: string, status: number, body: unknown): string[] {
  const response = operations[operationId]?.operation.responses?.[String(status)];
  if (!response) return [`${operationId} has no ${status} response in the contract`];
  const media = resolveRef(response).content?.['application/json'];
  const check = validator(`${operationId}:${status}`, media);
  if (!check) return []; // no JSON body is defined (204, a redirect, CSV)
  return check(body) ? [] : (check.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

/** Problems with a request body against the contract. */
export function requestProblems(operationId: string, body: unknown): string[] {
  const request = operations[operationId]?.operation.requestBody;
  const media = request ? resolveRef(request).content?.['application/json'] : undefined;
  const check = validator(`${operationId}:request`, media);
  if (!check) return [`${operationId} has no JSON request body in the contract`];
  return check(body) ? [] : (check.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

/** Problems with a body that should be the contract's Error shape. */
export function errorProblems(body: unknown): string[] {
  const check = validator('Error', { schema: { $ref: '#/components/schemas/Error' } });
  return !check || check(body) ? [] : (check.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

/** The status codes the contract defines for an operation. */
export function statusesOf(operationId: string): number[] {
  return Object.keys(operations[operationId]?.operation.responses ?? {})
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}
