import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";

import {
  SMART_CLIENT_ASSERTION_TYPE,
  parseCompactJwt,
  parseRequestedScopes,
  selectVerificationJwk,
  validateClientAssertionClaims,
  verifyParsedJwtSignature,
  type SupportedSmartAlgorithm,
} from "../lib/smart-backend-auth";

const router = Router();

const ACCESS_TOKEN_TTL_SECONDS = 300;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const JWKS_MAX_BYTES = 1024 * 1024;
const JWKS_TIMEOUT_MS = 5000;

type SmartClientRow = {
  client_id: string;
  jwks_uri: string;
  allowed_scopes: string[];
  allowed_algorithms: string[];
};

type CachedJwks = {
  expiresAt: number;
  value: unknown;
};

const jwksCache = new Map<string, CachedJwks>();

function oauthError(
  res: Response,
  status: number,
  error: string,
  description: string,
) {
  res.set({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });

  return res.status(status).json({
    error,
    error_description: description,
  });
}

function tokenEndpointAudience(): string {
  const raw = process.env.SMART_TOKEN_ENDPOINT?.trim();
  if (!raw) throw new Error("SMART_TOKEN_ENDPOINT is not configured.");

  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("SMART_TOKEN_ENDPOINT must be a canonical HTTPS URL.");
  }

  return url.toString();
}

function isForbiddenIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }

  return true;
}

async function validatedJwksUrl(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = new URL(raw);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local")
  ) {
    throw new Error("Registered JWKS URI is not permitted.");
  }

  const resolved = await lookup(url.hostname, { all: true, verbatim: true });
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
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        headers: {
          Accept: "application/jwk-set+json, application/json",
          "User-Agent": "THERASSISTANT-SMART-Gateway/1.0",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address, family);
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
  const result = await pool.query<SmartClientRow>(
    `
      select client_id, jwks_uri, allowed_scopes, allowed_algorithms
      from private.smart_backend_clients
      where client_id = $1
        and active = true
      limit 1
    `,
    [clientId],
  );

  return result.rows[0] ?? null;
}

function allowedAlgorithms(value: string[]): SupportedSmartAlgorithm[] {
  return value.filter(
    (item): item is SupportedSmartAlgorithm =>
      item === "RS384" || item === "ES384" || item === "RS256",
  );
}

router.post("/oauth/token", async (req: Request, res: Response) => {
  try {
    if (!req.is("application/x-www-form-urlencoded")) {
      return oauthError(
        res,
        400,
        "invalid_request",
        "Token requests must use application/x-www-form-urlencoded.",
      );
    }

    const body = req.body as Record<string, unknown>;

    if (body.grant_type !== "client_credentials") {
      return oauthError(res, 400, "unsupported_grant_type", "grant_type must be client_credentials.");
    }

    if (body.client_assertion_type !== SMART_CLIENT_ASSERTION_TYPE) {
      return oauthError(res, 400, "invalid_request", "client_assertion_type is invalid.");
    }

    if (typeof body.client_assertion !== "string" || !body.client_assertion.trim()) {
      return oauthError(res, 400, "invalid_request", "client_assertion is required.");
    }

    let parsed;
    try {
      parsed = parseCompactJwt(body.client_assertion);
    } catch {
      return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    }

    if (typeof parsed.payload.iss !== "string" || !parsed.payload.iss) {
      return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    }

    const client = await registeredClient(parsed.payload.iss);
    if (!client) {
      return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    }

    const algorithms = allowedAlgorithms(client.allowed_algorithms);
    if (
      typeof parsed.header.alg !== "string" ||
      !algorithms.includes(parsed.header.alg as SupportedSmartAlgorithm)
    ) {
      return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    }

    let jwks = await fetchJwks(client.jwks_uri);

    let jwk: Record<string, unknown>;
    try {
      jwk = selectVerificationJwk(jwks, parsed.header);
    } catch {
      jwks = await fetchJwks(client.jwks_uri, true);
      try {
        jwk = selectVerificationJwk(jwks, parsed.header);
      } catch {
        return oauthError(res, 401, "invalid_client", "Client authentication failed.");
      }
    }

    let signatureValid = false;
    try {
      signatureValid = verifyParsedJwtSignature(parsed, jwk);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    }

    let assertion;
    try {
      assertion = validateClientAssertionClaims(parsed.payload, {
        clientId: client.client_id,
        audience: tokenEndpointAudience(),
      });
    } catch {
      return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    }

    let scopes: string[];
    try {
      scopes = parseRequestedScopes(body.scope);
    } catch (error) {
      return oauthError(
        res,
        400,
        "invalid_scope",
        error instanceof Error ? error.message : "Requested scope is invalid.",
      );
    }

    if (scopes.some((scope) => !client.allowed_scopes.includes(scope))) {
      return oauthError(
        res,
        400,
        "invalid_scope",
        "Requested scope exceeds the client's pre-authorized access.",
      );
    }

    const accessToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(accessToken).digest("hex");
    const dbClient = await pool.connect();

    try {
      await dbClient.query("begin");

      await dbClient.query(
        `delete from private.smart_client_assertion_jti where expires_at < now()`,
      );

      await dbClient.query(
        `delete from private.smart_access_tokens where expires_at < now()`,
      );

      const replayInsert = await dbClient.query(
        `
          insert into private.smart_client_assertion_jti
            (client_id, jti, expires_at)
          values
            ($1, $2, to_timestamp($3))
          on conflict do nothing
          returning jti
        `,
        [client.client_id, assertion.jti, assertion.exp],
      );

      if (replayInsert.rowCount !== 1) {
        await dbClient.query("rollback");
        return oauthError(res, 401, "invalid_client", "Client authentication failed.");
      }

      await dbClient.query(
        `
          insert into private.smart_access_tokens
            (token_hash, client_id, scopes, issued_at, expires_at)
          values
            ($1, $2, $3, now(), now() + ($4 * interval '1 second'))
        `,
        [tokenHash, client.client_id, scopes, ACCESS_TOKEN_TTL_SECONDS],
      );

      await dbClient.query("commit");
    } catch (error) {
      await dbClient.query("rollback");
      throw error;
    } finally {
      dbClient.release();
    }

    res.set({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    });

    return res.status(200).json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
    });
  } catch (error) {
    req.log?.error?.({ error }, "SMART Backend Services token exchange failed");
    return oauthError(
      res,
      500,
      "server_error",
      "The authorization server could not process the request.",
    );
  }
});

export default router;
