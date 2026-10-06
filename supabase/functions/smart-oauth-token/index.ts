import { Buffer } from "node:buffer";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import postgres from "npm:postgres@3.4.7";

const SMART_CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const SMART_ASSERTION_MAX_LIFETIME_SECONDS = 300;
const SMART_CLOCK_SKEW_SECONDS = 5;
const ACCESS_TOKEN_TTL_SECONDS = 300;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const JWKS_MAX_BYTES = 1024 * 1024;
const JWKS_TIMEOUT_MS = 5000;
const MAX_REQUEST_BYTES = 32 * 1024;
const CANONICAL_TOKEN_ENDPOINT =
  Deno.env.get("SMART_TOKEN_ENDPOINT")?.trim() ||
  "https://therassistant.vercel.app/api/oauth/token";

type SupportedSmartAlgorithm = "RS384" | "ES384" | "RS256";
type SmartClientRow = {
  client_id: string;
  jwks_uri: string;
  allowed_scopes: string[];
  allowed_algorithms: string[];
};
type ParsedJwt = {
  signingInput: Buffer;
  signature: Buffer;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};
type CachedJwks = { expiresAt: number; value: unknown };

const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
if (!databaseUrl) throw new Error("SUPABASE_DB_URL is not configured.");

const sql = postgres(databaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 5,
});

const jwksCache = new Map<string, CachedJwks>();

function oauthResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...extraHeaders,
    },
  });
}

function oauthError(status: number, error: string, description: string) {
  return oauthResponse(
    { error, error_description: description },
    status,
  );
}

function decodeBase64UrlJson(segment: string, label: string): Record<string, unknown> {
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    const value = JSON.parse(decoded) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`Malformed JWT ${label}.`);
  }
}

function parseCompactJwt(jwt: string): ParsedJwt {
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Malformed JWT.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  return {
    signingInput: Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
    signature: Buffer.from(encodedSignature, "base64url"),
    header: decodeBase64UrlJson(encodedHeader, "header"),
    payload: decodeBase64UrlJson(encodedPayload, "payload"),
  };
}

function audienceContains(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  if (Array.isArray(aud)) {
    return aud.length > 0 &&
      aud.every((item) => typeof item === "string") &&
      aud.includes(expected);
  }
  return false;
}

function validateClientAssertionClaims(
  payload: Record<string, unknown>,
  clientId: string,
): { jti: string; exp: number } {
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== clientId || payload.sub !== clientId) {
    throw new Error("Client assertion issuer or subject is invalid.");
  }
  if (!audienceContains(payload.aud, CANONICAL_TOKEN_ENDPOINT)) {
    throw new Error("Client assertion audience is invalid.");
  }
  if (!Number.isInteger(payload.exp)) {
    throw new Error("Client assertion exp is required.");
  }

  const exp = payload.exp as number;
  if (exp <= now - SMART_CLOCK_SKEW_SECONDS) {
    throw new Error("Client assertion has expired.");
  }
  if (exp > now + SMART_ASSERTION_MAX_LIFETIME_SECONDS) {
    throw new Error("Client assertion expiration exceeds five minutes.");
  }

  if (payload.nbf !== undefined) {
    if (
      !Number.isInteger(payload.nbf) ||
      (payload.nbf as number) > now + SMART_CLOCK_SKEW_SECONDS
    ) {
      throw new Error("Client assertion is not yet valid.");
    }
  }

  if (payload.iat !== undefined) {
    if (!Number.isInteger(payload.iat)) {
      throw new Error("Client assertion iat is invalid.");
    }
    const iat = payload.iat as number;
    if (
      iat > now + SMART_CLOCK_SKEW_SECONDS ||
      exp - iat >
        SMART_ASSERTION_MAX_LIFETIME_SECONDS + SMART_CLOCK_SKEW_SECONDS
    ) {
      throw new Error("Client assertion lifetime is invalid.");
    }
  }

  if (
    typeof payload.jti !== "string" ||
    !payload.jti.trim() ||
    payload.jti.length > 200
  ) {
    throw new Error("Client assertion jti is required.");
  }

  return { jti: payload.jti, exp };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return value as string[];
}

function selectVerificationJwk(
  jwks: unknown,
  header: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof header.kid !== "string" || !header.kid.trim()) {
    throw new Error("JWT kid is required.");
  }
  if (
    header.alg !== "RS384" &&
    header.alg !== "ES384" &&
    header.alg !== "RS256"
  ) {
    throw new Error("JWT signing algorithm is not supported.");
  }
  if (!jwks || typeof jwks !== "object" || Array.isArray(jwks)) {
    throw new Error("JWKS response is invalid.");
  }

  const keys = (jwks as Record<string, unknown>).keys;
  if (!Array.isArray(keys)) throw new Error("JWKS response is invalid.");

  const matches = keys.filter((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const key = candidate as Record<string, unknown>;
    if (key.kid !== header.kid) return false;
    if (key.use !== undefined && key.use !== "sig") return false;
    const keyOps = key.key_ops === undefined ? null : stringArray(key.key_ops);
    if (key.key_ops !== undefined && (!keyOps || !keyOps.includes("verify"))) {
      return false;
    }
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

function verifyParsedJwtSignature(
  parsed: ParsedJwt,
  jwk: Record<string, unknown>,
): boolean {
  const alg = parsed.header.alg;
  if (alg !== "RS384" && alg !== "ES384" && alg !== "RS256") return false;

  const key = createPublicKey({
    key: jwk as any,
    format: "jwk",
  });

  if (
    (alg === "RS384" || alg === "RS256") &&
    key.asymmetricKeyDetails?.modulusLength &&
    key.asymmetricKeyDetails.modulusLength < 2048
  ) {
    return false;
  }

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

function parseRequestedScopes(scope: unknown): string[] {
  if (typeof scope !== "string" || !scope.trim()) {
    throw new Error("A SMART system scope is required.");
  }
  const scopes = [...new Set(scope.trim().split(/\s+/))];
  if (
    scopes.some(
      (item) => !/^system\/(?:\*|[A-Za-z][A-Za-z0-9]*)\.[cruds*]+$/.test(item),
    )
  ) {
    throw new Error("Requested scope is not a valid SMART v2 system scope.");
  }
  return scopes;
}

function isForbiddenIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isForbiddenIp(normalized.slice("::ffff:".length));
    }
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return true;
}

async function validatedJwksUrl(
  raw: string,
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    net.isIP(hostname) !== 0
  ) {
    throw new Error("Registered JWKS URI is not permitted.");
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((entry) => isForbiddenIp(entry.address))) {
    throw new Error("Registered JWKS URI does not resolve to a public address.");
  }

  return {
    url,
    address: resolved[0].address,
    family: resolved[0].family as 4 | 6,
  };
}

async function fetchJwks(uri: string, forceRefresh = false): Promise<unknown> {
  const cached = jwksCache.get(uri);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { url, address, family } = await validatedJwksUrl(uri);

  const body = await new Promise<string>((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: address,
        family,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        headers: {
          Host: url.host,
          Accept: "application/jwk-set+json, application/json",
          "User-Agent": "THERASSISTANT-SMART-Gateway/1.0",
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error("JWKS endpoint returned an unexpected status."));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > JWKS_MAX_BYTES) {
            request.destroy(new Error("JWKS response exceeded the maximum size."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );

    request.setTimeout(JWKS_TIMEOUT_MS, () => {
      request.destroy(new Error("JWKS request timed out."));
    });
    request.on("error", reject);
    request.end();
  });

  const parsed = JSON.parse(body) as unknown;
  jwksCache.set(uri, {
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
    value: parsed,
  });
  return parsed;
}

async function registeredClient(clientId: string): Promise<SmartClientRow | null> {
  const rows = await sql`
    select client_id, jwks_uri, allowed_scopes, allowed_algorithms
    from private.smart_backend_clients
    where client_id = ${clientId}
      and active = true
    limit 1
  `;
  return (rows[0] as SmartClientRow | undefined) ?? null;
}

function allowedAlgorithms(value: string[]): SupportedSmartAlgorithm[] {
  return value.filter(
    (item): item is SupportedSmartAlgorithm =>
      item === "RS384" || item === "ES384" || item === "RS256",
  );
}

function getSingleParam(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw new Error(`Duplicate ${name} parameter.`);
  return values[0];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return oauthResponse(
      {
        error: "invalid_request",
        error_description: "The token endpoint only accepts POST requests.",
      },
      405,
      { Allow: "POST" },
    );
  }

  const contentType = (req.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/x-www-form-urlencoded") {
    return oauthError(
      400,
      "invalid_request",
      "Token requests must use application/x-www-form-urlencoded.",
    );
  }

  try {
    const rawBody = await req.text();
    if (!rawBody || Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      return oauthError(400, "invalid_request", "Token request body is invalid.");
    }

    const params = new URLSearchParams(rawBody);
    let grantType: string | undefined;
    let assertionType: string | undefined;
    let clientAssertion: string | undefined;
    let scope: string | undefined;
    try {
      grantType = getSingleParam(params, "grant_type");
      assertionType = getSingleParam(params, "client_assertion_type");
      clientAssertion = getSingleParam(params, "client_assertion");
      scope = getSingleParam(params, "scope");
    } catch {
      return oauthError(400, "invalid_request", "Token request parameters are invalid.");
    }

    if (grantType !== "client_credentials") {
      return oauthError(
        400,
        "unsupported_grant_type",
        "grant_type must be client_credentials.",
      );
    }

    if (assertionType !== SMART_CLIENT_ASSERTION_TYPE) {
      return oauthError(
        400,
        "invalid_request",
        "client_assertion_type is invalid.",
      );
    }

    if (
      typeof clientAssertion !== "string" ||
      !clientAssertion.trim() ||
      clientAssertion.length > 16_384
    ) {
      return oauthError(400, "invalid_request", "client_assertion is required.");
    }

    let parsed: ParsedJwt;
    try {
      parsed = parseCompactJwt(clientAssertion);
    } catch {
      return oauthError(401, "invalid_client", "Client authentication failed.");
    }

    if (typeof parsed.payload.iss !== "string" || !parsed.payload.iss) {
      return oauthError(401, "invalid_client", "Client authentication failed.");
    }

    const client = await registeredClient(parsed.payload.iss);
    if (!client) {
      return oauthError(401, "invalid_client", "Client authentication failed.");
    }

    const algorithms = allowedAlgorithms(client.allowed_algorithms);
    if (
      typeof parsed.header.alg !== "string" ||
      !algorithms.includes(parsed.header.alg as SupportedSmartAlgorithm)
    ) {
      return oauthError(401, "invalid_client", "Client authentication failed.");
    }

    let jwks: unknown;
    try {
      jwks = await fetchJwks(client.jwks_uri);
    } catch (error) {
      console.error(
        "SMART JWKS retrieval failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      return oauthError(
        503,
        "temporarily_unavailable",
        "Client key verification is temporarily unavailable.",
      );
    }

    let jwk: Record<string, unknown>;
    try {
      jwk = selectVerificationJwk(jwks, parsed.header);
    } catch {
      try {
        jwks = await fetchJwks(client.jwks_uri, true);
        jwk = selectVerificationJwk(jwks, parsed.header);
      } catch {
        return oauthError(401, "invalid_client", "Client authentication failed.");
      }
    }

    let signatureValid = false;
    try {
      signatureValid = verifyParsedJwtSignature(parsed, jwk);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return oauthError(401, "invalid_client", "Client authentication failed.");
    }

    let assertion: { jti: string; exp: number };
    try {
      assertion = validateClientAssertionClaims(parsed.payload, client.client_id);
    } catch {
      return oauthError(401, "invalid_client", "Client authentication failed.");
    }

    let scopes: string[];
    try {
      scopes = parseRequestedScopes(scope);
    } catch (error) {
      return oauthError(
        400,
        "invalid_scope",
        error instanceof Error ? error.message : "Requested scope is invalid.",
      );
    }

    if (scopes.some((item) => !client.allowed_scopes.includes(item))) {
      return oauthError(
        400,
        "invalid_scope",
        "Requested scope exceeds the client's pre-authorized access.",
      );
    }

    const accessToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(accessToken).digest("hex");

    const issued = await sql.begin(async (tx) => {
      await tx`
        delete from private.smart_client_assertion_jti
        where expires_at < now()
      `;
      await tx`
        delete from private.smart_access_tokens
        where expires_at < now()
      `;

      const replayInsert = await tx`
        insert into private.smart_client_assertion_jti
          (client_id, jti, expires_at)
        values
          (${client.client_id}, ${assertion.jti}, to_timestamp(${assertion.exp}))
        on conflict do nothing
        returning jti
      `;

      if (replayInsert.length !== 1) return false;

      await tx`
        insert into private.smart_access_tokens
          (token_hash, client_id, scopes, issued_at, expires_at)
        values
          (
            ${tokenHash},
            ${client.client_id},
            ${tx.array(scopes)},
            now(),
            now() + ${ACCESS_TOKEN_TTL_SECONDS} * interval '1 second'
          )
      `;
      return true;
    });

    if (!issued) {
      return oauthError(401, "invalid_client", "Client authentication failed.");
    }

    return oauthResponse({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
    });
  } catch (error) {
    console.error(
      "SMART Backend Services token exchange failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return oauthError(
      500,
      "server_error",
      "The authorization server could not process the request.",
    );
  }
});
