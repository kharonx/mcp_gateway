import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Validates incoming bearer tokens in HTTP mode. The token must be an Entra ID
 * access token issued for this application (audience = CLIENT_ID / api://CLIENT_ID).
 * Set the app registration's accessTokenAcceptedVersion to 2 for v2 issuer.
 */
export class TokenValidator {
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private issuers: string[];
  private audiences: string[];

  constructor(tenantId: string, clientId: string) {
    this.jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
    this.issuers = [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ];
    this.audiences = [clientId, `api://${clientId}`];
  }

  async validate(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuers,
      audience: this.audiences,
    });
    return payload;
  }
}

export function userFromClaims(payload: JWTPayload): string {
  return (
    (payload.preferred_username as string) ??
    (payload.upn as string) ??
    (payload.email as string) ??
    (payload.oid as string) ??
    "unknown"
  );
}
