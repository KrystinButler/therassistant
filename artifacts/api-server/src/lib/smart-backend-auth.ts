import { createPublicKey, verify } from "node:crypto";

export const SMART_CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

export const SMART_ASSERTION_MAX_LIFETIME_SECONDS = 300;
export const SMART_CLOCK_SKEW_SECONDS = 5;

export type SupportedSmartAlgorithm = "RS384" | "ES384" | "RS256";

export type ParsedJwt = {
  encodedHeader: string;
  encodedPayload: string;
  signingInput: Buffer;
  signature: Buffer;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};

function decodeBase64UrlJson(segment: string, label: string): Record<string, unknown> {
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    const value = JSON.parse(decoded) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`Malformed JWT ${label}.`);
  }
}

export function parseCompactJwt(jwt: string): ParsedJwt {
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Malformed JWT.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  return {
    encodedHeader,
    encodedPayload,
    signingInput: Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
    signature: Buffer.from(encodedSignature, "base64url"),
    header: decodeBase64UrlJson(encodedHeader, "header"),
    payload: decodeBase64UrlJson(encodedPayload, "payload"),
  };
}

function audienceContains(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  if (Array.isArray(aud)) {
    return aud.length > 0 && aud.every((item) => typeof item === "string") && aud.includes(expected);
  }
  return false;
}

export function validateClientAssertionClaims(
  payload: Record<string, unknown>,
  options: {
    clientId: string;
    audience: string;
    nowSeconds?: number;
    maxLifetimeSeconds?: number;
    clockSkewSeconds?: number;
  },
): { jti: string; exp: number } {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxLifetime = options.maxLifetimeSeconds ?? SMART_ASSERTION_MAX_LIFETIME_SECONDS;
  const skew = options.clockSkewSeconds ?? SMART_CLOCK_SKEW_SECONDS;

  if (payload.iss !== options.clientId || payload.sub !== options.clientId) {
    throw new Error("Client assertion issuer or subject is invalid.");
  }

  if (!audienceContains(payload.aud, options.audience)) {
    throw new Error("Client assertion audience is invalid.");
  }

  if (!Number.isInteger(payload.exp)) {
    throw new Error("Client assertion exp is required.");
  }

  const exp = payload.exp as number;
  if (exp <= now - skew) {
    throw new Error("Client assertion has expired.");
  }

  if (exp > now + maxLifetime) {
    throw new Error("Client assertion expiration exceeds five minutes.");
  }

  if (payload.nbf !== undefined) {
    if (!Number.isInteger(payload.nbf) || (payload.nbf as number) > now + skew) {
      throw new Error("Client assertion is not yet valid.");
    }
  }

  if (payload.iat !== undefined) {
    if (!Number.isInteger(payload.iat)) {
      throw new Error("Client assertion iat is invalid.");
    }
    const iat = payload.iat as number;
    if (iat > now + skew || exp - iat > maxLifetime + skew) {
      throw new Error("Client assertion lifetime is invalid.");
    }
  }

  if (typeof payload.jti !== "string" || !payload.jti.trim() || payload.jti.length > 200) {
    throw new Error("Client assertion jti is required.");
  }

  return { jti: payload.jti, exp };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value as string[];
}

export function selectVerificationJwk(
  jwks: unknown,
  header: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof header.kid !== "string" || !header.kid.trim()) {
    throw new Error("JWT kid is required.");
  }

  if (header.alg !== "RS384" && header.alg !== "ES384" && header.alg !== "RS256") {
    throw new Error("JWT signing algorithm is not supported.");
  }

  if (!jwks || typeof jwks !== "object" || Array.isArray(jwks)) {
    throw new Error("JWKS response is invalid.");
  }

  const keys = (jwks as Record<string, unknown>).keys;
  if (!Array.isArray(keys)) {
    throw new Error("JWKS response is invalid.");
  }

  const matches = keys.filter((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const key = candidate as Record<string, unknown>;
    if (key.kid !== header.kid) return false;
    if (key.use !== undefined && key.use !== "sig") return false;
    const keyOps = key.key_ops === undefined ? null : stringArray(key.key_ops);
    if (key.key_ops !== undefined && (!keyOps || !keyOps.includes("verify"))) return false;
    if (key.alg !== undefined && key.alg !== header.alg) return false;

    if (header.alg === "ES384") {
      return key.kty === "EC" && key.crv === "P-384";
    }

    return key.kty === "RSA";
  });

  if (matches.length !== 1) {
    throw new Error("Unable to select a unique verification key.");
  }

  return matches[0] as Record<string, unknown>;
}

export function verifyParsedJwtSignature(
  parsed: ParsedJwt,
  jwk: Record<string, unknown>,
): boolean {
  const alg = parsed.header.alg;
  if (alg !== "RS384" && alg !== "ES384" && alg !== "RS256") return false;

  const key = createPublicKey({
    key: jwk as any,
    format: "jwk",
  });

  if (alg === "ES384") {
    return verify(
      "sha384",
      parsed.signingInput,
      { key, dsaEncoding: "ieee-p1363" },
      parsed.signature,
    );
  }

  return verify(
    alg === "RS384" ? "RSA-SHA384" : "RSA-SHA256",
    parsed.signingInput,
    key,
    parsed.signature,
  );
}

export function parseRequestedScopes(scope: unknown): string[] {
  if (typeof scope !== "string" || !scope.trim()) {
    throw new Error("A SMART system scope is required.");
  }

  const scopes = [...new Set(scope.trim().split(/\s+/))];

  if (scopes.some((item) => !/^system\/[A-Za-z][A-Za-z0-9]*\.[cruds*]+$/.test(item))) {
    throw new Error("Requested scope is not a valid SMART v2 system scope.");
  }

  return scopes;
}
