/** Safe errors never retain response bodies, URLs, cookies or fetch causes. */
export class MeuhedetError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message); this.name = this.constructor.name;
  }
}
export class AuthenticationError extends MeuhedetError {
  constructor(code = "AUTHENTICATION_FAILED", status?: number) {
    super(code, "Meuhedet sign-in could not be completed.", status);
  }
}
export class ReauthenticationRequired extends MeuhedetError {
  constructor(status?: number) { super("REAUTHENTICATION_REQUIRED", "Sign in to Meuhedet again.", status); }
}
export class UpstreamError extends MeuhedetError {
  constructor(code = "UPSTREAM_ERROR", status?: number) { super(code, "The Meuhedet request could not be completed.", status); }
}
