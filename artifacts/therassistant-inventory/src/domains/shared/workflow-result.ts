export type WorkflowResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      blocked: boolean;
      code: string;
      message: string;
      details?: string[];
    };

export function success<T>(value: T): WorkflowResult<T> {
  return { ok: true, value };
}

export function blocked(
  code: string,
  message: string,
  details?: string[],
): WorkflowResult<never> {
  return { ok: false, blocked: true, code, message, details };
}

export function failure(
  code: string,
  message: string,
  details?: string[],
): WorkflowResult<never> {
  return { ok: false, blocked: false, code, message, details };
}
