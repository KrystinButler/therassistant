import type { RequestHandler } from "express";

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type TenantAuthContext = {
  userId: string;
  tenantId: string;
  roles: string[];
};

declare global {
  namespace Express {
    interface Request {
      tenantAuth?: TenantAuthContext;
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabaseAuthConfig() {
  const url = (
    process.env.SUPABASE_URL ??
    process.env.E2E_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    ""
  ).replace(/\/$/, "");

  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.PUBLISHABLE_KEY ??
    process.env.ANON_KEY ??
    "";

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase URL and publishable key are required for API authentication.",
    );
  }

  return { url, publishableKey };
}

function readBearerToken(header: string | undefined) {
  if (!header) return null;

  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function verifySupabaseUser(accessToken: string) {
  const { url, publishableKey } = getSupabaseAuthConfig();

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    id?: unknown;
  };

  if (
    typeof payload.id !== "string" ||
    !UUID_PATTERN.test(payload.id)
  ) {
    return null;
  }

  return payload.id;
}

export const requireAuthenticatedTenant: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const accessToken = readBearerToken(
      req.get("Authorization") ?? undefined,
    );

    if (!accessToken) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const userId = await verifySupabaseUser(accessToken);

    if (!userId) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    const requestedTenantId = req.get("X-Tenant-Id")?.trim();

    if (
      !requestedTenantId ||
      !UUID_PATTERN.test(requestedTenantId)
    ) {
      res.status(400).json({ error: "Valid tenant context required" });
      return;
    }

    const membership = await db.execute(sql`
      SELECT
        tu.tenant_id::text AS "tenantId",
        COALESCE(
          array_agg(DISTINCT tur.role::text)
            FILTER (WHERE tur.role IS NOT NULL),
          ARRAY[]::text[]
        ) AS roles
      FROM tenant_users tu
      LEFT JOIN tenant_user_roles tur
        ON tur.tenant_id = tu.tenant_id
       AND tur.user_id = tu.user_id
      WHERE tu.user_id = ${userId}::uuid
        AND tu.tenant_id = ${requestedTenantId}::uuid
        AND tu.status = 'active'
      GROUP BY tu.tenant_id
      LIMIT 1
    `);

    if (!membership.rows.length) {
      res.status(403).json({ error: "Tenant access denied" });
      return;
    }

    const row = membership.rows[0] as {
      tenantId?: unknown;
      roles?: unknown;
    };

    const roles = Array.isArray(row.roles)
      ? row.roles.filter(
          (role): role is string => typeof role === "string",
        )
      : [];

    req.tenantAuth = {
      userId,
      tenantId: requestedTenantId,
      roles,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export function getTenantAuthContext(
  req: Express.Request,
): TenantAuthContext {
  if (!req.tenantAuth) {
    throw new Error("Authenticated tenant context is missing.");
  }

  return req.tenantAuth;
}
