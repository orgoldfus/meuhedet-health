/** Drop known identity, authentication, and private-link fields from account output. */
const omittedKeys = new Set([
  "memberid", "memberidcode", "patientid", "patientidcode", "membertechnicalid", "loggedcustomerinfo", "currentcustomerinfo", "familydata", "authorizationtoaccount",
  "idtech", "checksumid", "nationalid", "passportnumber", "unifierid", "unifieridcode", "paysid", "paysidcode", "accountnumber",
  "authorization", "apiauthorization", "authentication", "cookie", "cookies", "setcookie", "mrhsession", "lastmrhsession", "token", "accesstoken", "refreshtoken", "idtoken", "apikey", "jwt",
  "session", "sessionid", "samlresponse", "relaystate", "password", "otp", "hash", "coronahash", "coronat",
  "pdflink", "linkpdf", "filelink", "visitsummarypdflink", "referralpdflink", "resultfile", "resultfiles",
  // Retained from the predecessor's known sensitive key set; harmless if absent.
  "patientname", "patientbirthdate", "accessionnumber", "viewportlabels", "attributes",
]);

/**
 * Deep copy with known sensitive keys removed at every depth. Clinical prose may still contain
 * identifiers; this is not a de-identification guarantee.
 */
export function safeClinical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeClinical);
  if (!value || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!omittedKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
      Object.defineProperty(result, key, { value: safeClinical(item), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
