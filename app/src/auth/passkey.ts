import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

/**
 * Passkeys in the browser (docs/guides/identity.md §3): the device's fingerprint,
 * face or screen lock makes or signs with a passkey for the options the API sends,
 * and the answer goes back untouched. The API builds and checks every ceremony;
 * this file only hands its JSON to the browser and the browser's answer back.
 */

/** WebAuthn's JSON, as the contract passes it (`WebAuthnJson`). */
type Json = Record<string, unknown>;

/** Can this browser use passkeys at all? */
export const passkeysWork = (): boolean => browserSupportsWebAuthn();

/** Make a passkey for the options from POST /security/passkeys/options. */
export async function createPasskey(options: Json): Promise<Json> {
  const answer = await startRegistration({ optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON });
  return answer as unknown as Json;
}

/** Sign with a passkey this device holds, for options from /auth/passkey/options or /security/confirm/options. */
export async function signWithPasskey(options: Json): Promise<Json> {
  const answer = await startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON });
  return answer as unknown as Json;
}

/** The person closed the prompt, or it timed out: nothing went wrong, so nothing is said. */
export function passkeyCancelled(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

/** A passkey prompt that failed for another reason, in a person's words (a toast, at most 8 words). */
export function passkeyProblem(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === "InvalidStateError") return "This device already has your passkey";
  if (name === "SecurityError") return "Passkeys do not work on this address";
  return (e as Error | null)?.message || "The passkey did not work";
}
