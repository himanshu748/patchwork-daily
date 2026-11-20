import type { ClientError, ClientErrorCode, ClientResult } from '../../shared/api';

function failure(code: ClientErrorCode, message: string): ClientError {
  return { ok: false, code, message, retry: true };
}

function isResult(value: unknown): value is { readonly ok: boolean } {
  return typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean';
}

/**
 * Never rejects: a network error, a timeout, a body that is not JSON or a body without `ok`
 * becomes a retryable NETWORK or TIMEOUT error.
 */
async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<ClientResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = { method, signal: controller.signal };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    const json: unknown = await res.json();
    if (!isResult(json)) return failure('NETWORK', `Unexpected response from ${path} (HTTP ${res.status})`);
    // The Server builds every body as ApiResult<T>; `ok` was checked above.
    return json as ClientResult<T>;
  } catch {
    return controller.signal.aborted ? failure('TIMEOUT', `${path} timed out`) : failure('NETWORK', `${path} failed`);
  } finally {
    clearTimeout(timer);
  }
}

export function apiGet<T>(path: string, timeoutMs: number): Promise<ClientResult<T>> {
  return request<T>('GET', path, undefined, timeoutMs);
}

export function apiPost<T>(path: string, body: unknown, timeoutMs: number): Promise<ClientResult<T>> {
  return request<T>('POST', path, body ?? {}, timeoutMs);
}
