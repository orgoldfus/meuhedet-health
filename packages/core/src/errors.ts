/** Safe errors never retain response bodies, URLs, cookies or fetch causes. */
export class MeuhedetError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message); this.name = this.constructor.name;
  }
}
export interface AuthenticationDiagnostics {
  formCount: number;
  postFormCount: number;
  csrfPostFormCount: number;
  codeFieldCount: number;
  hiddenCodeFieldCount: number;
  unnamedDigitCount: number;
  recognizedDigitCount: number;
  candidateCount: number;
  loginFormReturned: boolean;
  validationErrorPresent: boolean;
}
export class AuthenticationError extends MeuhedetError {
  readonly diagnostics?: AuthenticationDiagnostics;
  constructor(code = "AUTHENTICATION_FAILED", status?: number, diagnostics?: AuthenticationDiagnostics) {
    super(code, "Meuhedet sign-in could not be completed.", status);
    if (diagnostics) {
      const bounded = (value: number) => Number.isSafeInteger(value) ? Math.min(100, Math.max(0, value)) : 0;
      this.diagnostics = {
        formCount: bounded(diagnostics.formCount), postFormCount: bounded(diagnostics.postFormCount), csrfPostFormCount: bounded(diagnostics.csrfPostFormCount),
        codeFieldCount: bounded(diagnostics.codeFieldCount), hiddenCodeFieldCount: bounded(diagnostics.hiddenCodeFieldCount), unnamedDigitCount: bounded(diagnostics.unnamedDigitCount), recognizedDigitCount: bounded(diagnostics.recognizedDigitCount),
        candidateCount: bounded(diagnostics.candidateCount), loginFormReturned: diagnostics.loginFormReturned === true, validationErrorPresent: diagnostics.validationErrorPresent === true,
      };
    }
  }
}
export class ReauthenticationRequired extends MeuhedetError {
  constructor(status?: number) { super("REAUTHENTICATION_REQUIRED", "Sign in to Meuhedet again.", status); }
}
export class UpstreamError extends MeuhedetError {
  constructor(code = "UPSTREAM_ERROR", status?: number) { super(code, "The Meuhedet request could not be completed.", status); }
}
