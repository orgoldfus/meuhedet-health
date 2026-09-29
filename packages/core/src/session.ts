import type { SerializedCookieJar } from "tough-cookie";
/** Sensitive bearer material; never log or place in tool output. */
export interface MeuhedetSession {
  provider: "meuhedet";
  version: 1;
  cookies: SerializedCookieJar;
  authenticatedAt: string;
}
