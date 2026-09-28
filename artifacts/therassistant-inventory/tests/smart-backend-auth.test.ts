import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  parseCompactJwt,
  parseRequestedScopes,
  selectVerificationJwk,
  validateClientAssertionClaims,
  verifyParsedJwtSignature,
} from "../../api-server/src/lib/smart-backend-auth";

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: any,
  algorithm: string,
  dsaEncoding?: "ieee-p1363",
) {
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const signature = sign(
    algorithm,
    Buffer.from(signingInput, "ascii"),
    dsaEncoding ? { key: privateKey, dsaEncoding } : privateKey,
  ).toString("base64url");

  return `${signingInput}.${signature}`;
}

test("SMART Backend Services validates RS384 assertions", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  jwk.kid = "rsa-1";
  jwk.use = "sig";
  jwk.alg = "RS384";

  const now = 1_800_000_000;
  const jwt = makeJwt(
    { alg: "RS384", kid: "rsa-1", typ: "JWT" },
    {
      iss: "client-a",
      sub: "client-a",
      aud: "https://api.example.test/api/oauth/token",
      exp: now + 240,
      jti: "assertion-1",
    },
    privateKey,
    "RSA-SHA384",
  );

  const parsed = parseCompactJwt(jwt);
  const selected = selectVerificationJwk({ keys: [jwk] }, parsed.header);

  assert.equal(verifyParsedJwtSignature(parsed, selected), true);
  assert.deepEqual(
    validateClientAssertionClaims(parsed.payload, {
      clientId: "client-a",
      audience: "https://api.example.test/api/oauth/token",
      nowSeconds: now,
    }),
    { jti: "assertion-1", exp: now + 240 },
  );
});

test("SMART Backend Services validates ES384 assertions", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  jwk.kid = "ec-1";
  jwk.use = "sig";
  jwk.alg = "ES384";

  const now = 1_800_000_000;
  const jwt = makeJwt(
    { alg: "ES384", kid: "ec-1", typ: "JWT" },
    {
      iss: "client-b",
      sub: "client-b",
      aud: "https://api.example.test/api/oauth/token",
      exp: now + 240,
      jti: "assertion-2",
    },
    privateKey,
    "sha384",
    "ieee-p1363",
  );

  const parsed = parseCompactJwt(jwt);
  const selected = selectVerificationJwk({ keys: [jwk] }, parsed.header);

  assert.equal(verifyParsedJwtSignature(parsed, selected), true);
});

test("assertions over five minutes are rejected", () => {
  assert.throws(() =>
    validateClientAssertionClaims(
      {
        iss: "client-a",
        sub: "client-a",
        aud: "https://api.example.test/api/oauth/token",
        exp: 1_800_000_400,
        jti: "too-long",
      },
      {
        clientId: "client-a",
        audience: "https://api.example.test/api/oauth/token",
        nowSeconds: 1_800_000_000,
        clockSkewSeconds: 0,
      },
    ),
  );
});

test("issuer, subject, audience, and jti are mandatory", () => {
  const options = {
    clientId: "client-a",
    audience: "https://api.example.test/api/oauth/token",
    nowSeconds: 1_800_000_000,
  };

  assert.throws(() =>
    validateClientAssertionClaims(
      {
        iss: "client-a",
        sub: "other-client",
        aud: options.audience,
        exp: 1_800_000_200,
        jti: "a",
      },
      options,
    ),
  );

  assert.throws(() =>
    validateClientAssertionClaims(
      {
        iss: "client-a",
        sub: "client-a",
        aud: "https://wrong.example.test/token",
        exp: 1_800_000_200,
        jti: "a",
      },
      options,
    ),
  );

  assert.throws(() =>
    validateClientAssertionClaims(
      {
        iss: "client-a",
        sub: "client-a",
        aud: options.audience,
        exp: 1_800_000_200,
      },
      options,
    ),
  );
});

test("SMART v2 system scopes are accepted and v1 read syntax is rejected", () => {
  assert.deepEqual(
    parseRequestedScopes("system/Practitioner.rs system/Patient.r"),
    ["system/Practitioner.rs", "system/Patient.r"],
  );

  assert.deepEqual(parseRequestedScopes("system/*.rs"), ["system/*.rs"]);
  assert.throws(() => parseRequestedScopes("system/Practitioner.read"));
});
