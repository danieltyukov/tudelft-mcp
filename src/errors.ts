/**
 * Stable error codes returned to MCP clients. Upstream error bodies, URLs and
 * cookies never travel inside these; only the code, a short message and small
 * structured details.
 */
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'OSIRIS_AUTH_REQUIRED'
  | 'TIMETABLE_NOT_CONNECTED'
  | 'LOGIN_IN_PROGRESS'
  | 'LOGIN_TIMEOUT'
  | 'LOGIN_CANCELLED'
  | 'BROWSER_NOT_FOUND'
  | 'BROWSER_BUSY'
  | 'ACCOUNT_CHANGED'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'UNAVAILABLE'
  | 'FORMAT_CHANGED'
  | 'INVALID_ARGUMENT'
  | 'INVALID_URL'
  | 'EXTERNAL_RESOURCE'
  | 'FILE_TOO_LARGE'
  | 'DOCUMENT_PARSE_FAILED'
  | 'DOCUMENT_TIMEOUT'
  | 'PREVIEW_EXPIRED'
  | 'PREVIEW_CHANGED'
  | 'CONFIRMATION_REQUIRED'
  | 'OUTCOME_UNKNOWN'
  | 'ALREADY_DONE'
  | 'NOT_ALLOWED'
  | 'SYNC_BUSY'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class TudelftError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TudelftError';
  }
}

export interface SafeError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function toSafeError(error: unknown): SafeError {
  if (error instanceof TudelftError) {
    return error.details
      ? { code: error.code, message: error.message, details: error.details }
      : { code: error.code, message: error.message };
  }
  return {
    code: 'INTERNAL_ERROR',
    message:
      'The operation failed unexpectedly. Run "tudelft-mcp status" to check connectivity and sign-in state.',
  };
}

export function isAuthError(error: unknown): boolean {
  return (
    error instanceof TudelftError && (error.code === 'AUTH_REQUIRED' || error.code === 'OSIRIS_AUTH_REQUIRED')
  );
}
