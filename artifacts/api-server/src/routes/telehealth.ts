import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";

import { db } from "@workspace/db";

import {
  createDailyMeetingToken,
  createDailyRoom,
  shouldReuseTelehealthRoom,
} from "../lib/daily";
import { decideTelehealthAccess } from "../lib/telehealth-access";
import {
  getUserAuthContext,
  requireAuthenticatedUser,
} from "../middlewares/auth";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AccessRow = {
  id: string;
  tenantId: string;
  endsAt: Date | string;
  locationType: string;
  isPlatformAdmin: boolean;
  isPracticeAdmin: boolean;
  isAssignedClinician: boolean;
  isPortalPatient: boolean;
  patientCheckInSubmitted: boolean;
};

type RoomRow = {
  telehealthProvider: string | null;
  telehealthRoomName: string | null;
  telehealthUrl: string | null;
  telehealthRoomExpiresAt: Date | string | null;
};

router.post(
  "/telehealth/appointments/:appointmentId/session",
  requireAuthenticatedUser,
  async (req, res, next) => {
    try {
      const rawId = req.params.appointmentId;
      const appointmentId = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!appointmentId || !UUID_PATTERN.test(appointmentId)) {
        return res.status(404).json({ error: "Telehealth appointment not found" });
      }

      const { userId } = getUserAuthContext(req);
      const accessResult = await db.execute(sql`
        SELECT
          a.id::text AS "id",
          a.tenant_id::text AS "tenantId",
          a.ends_at AS "endsAt",
          a.location_type::text AS "locationType",
          EXISTS (
            SELECT 1
            FROM tenant_users tu
            JOIN tenant_user_roles tur
              ON tur.tenant_id = tu.tenant_id
             AND tur.user_id = tu.user_id
            WHERE tu.tenant_id = a.tenant_id
              AND tu.user_id = ${userId}::uuid
              AND tu.status = 'active'
              AND tur.role::text = 'platform_admin'
          ) AS "isPlatformAdmin",
          EXISTS (
            SELECT 1
            FROM tenant_users tu
            JOIN tenant_user_roles tur
              ON tur.tenant_id = tu.tenant_id
             AND tur.user_id = tu.user_id
            WHERE tu.tenant_id = a.tenant_id
              AND tu.user_id = ${userId}::uuid
              AND tu.status = 'active'
              AND tur.role::text = 'practice_admin'
          ) AS "isPracticeAdmin",
          EXISTS (
            SELECT 1
            FROM provider_user_links pul
            WHERE pul.tenant_id = a.tenant_id
              AND pul.provider_id = a.provider_id
              AND pul.user_id = ${userId}::uuid
              AND pul.status = 'active'
          ) AS "isAssignedClinician",
          EXISTS (
            SELECT 1
            FROM client_portal_access cpa
            WHERE cpa.tenant_id = a.tenant_id
              AND cpa.client_id = a.client_id
              AND cpa.user_id = ${userId}::uuid
              AND cpa.status = 'active'
          ) AS "isPortalPatient",
          EXISTS (
            SELECT 1
            FROM client_checkins cc
            WHERE cc.tenant_id = a.tenant_id
              AND cc.client_id = a.client_id
              AND cc.appointment_id = a.id
              AND NULLIF(BTRIM(cc.responses #>> '{pre_visit,submitted_at}'), '') IS NOT NULL
          ) AS "patientCheckInSubmitted"
        FROM appointments a
        WHERE a.id = ${appointmentId}::uuid
        LIMIT 1
      `);

      const appointment = accessResult.rows[0] as AccessRow | undefined;
      if (!appointment) {
        return res.status(404).json({ error: "Telehealth appointment not found" });
      }
      if (appointment.locationType !== "telehealth") {
        return res.status(409).json({
          error: "This appointment is not configured for telehealth",
          code: "NOT_TELEHEALTH",
        });
      }

      const access = decideTelehealthAccess(appointment);
      if (!access.allowed) {
        if (access.reason === "check_in_required" && appointment.isPortalPatient) {
          return res.status(409).json({
            error: "Complete pre-visit check-in before joining the visit",
            code: "CHECK_IN_REQUIRED",
          });
        }
        return res.status(404).json({ error: "Telehealth appointment not found" });
      }

      let session: RoomRow;
      try {
        session = await db.transaction(async (tx) => {
          const currentResult = await tx.execute(sql`
            SELECT
              telehealth_provider AS "telehealthProvider",
              telehealth_room_name AS "telehealthRoomName",
              telehealth_url AS "telehealthUrl",
              telehealth_room_expires_at AS "telehealthRoomExpiresAt"
            FROM appointments
            WHERE id = ${appointmentId}::uuid
              AND tenant_id = ${appointment.tenantId}::uuid
            FOR UPDATE
          `);
          const current = currentResult.rows[0] as RoomRow | undefined;
          if (!current) {
            throw new Error("Telehealth appointment disappeared during provisioning.");
          }
          if (shouldReuseTelehealthRoom({
            provider: current.telehealthProvider,
            roomName: current.telehealthRoomName,
            url: current.telehealthUrl,
            expiresAt: current.telehealthRoomExpiresAt,
          })) {
            return current;
          }

          const created = await createDailyRoom({
            appointmentEndsAt: appointment.endsAt,
          });
          const persisted = await tx.execute(sql`
            UPDATE appointments
            SET
              telehealth_provider = 'daily',
              telehealth_room_name = ${created.room.name},
              telehealth_url = ${created.room.url},
              telehealth_room_expires_at = ${created.expiresAt},
              updated_at = now()
            WHERE id = ${appointmentId}::uuid
              AND tenant_id = ${appointment.tenantId}::uuid
            RETURNING
              telehealth_provider AS "telehealthProvider",
              telehealth_room_name AS "telehealthRoomName",
              telehealth_url AS "telehealthUrl",
              telehealth_room_expires_at AS "telehealthRoomExpiresAt"
          `);
          const row = persisted.rows[0] as RoomRow | undefined;
          if (!row) throw new Error("Unable to persist the telehealth room.");
          return row;
        });
      } catch {
        return res.status(503).json({
          error: "Telehealth is unavailable or not configured for HIPAA use",
          code: "TELEHEALTH_UNAVAILABLE",
        });
      }

      if (!session.telehealthRoomName || !session.telehealthUrl || !session.telehealthRoomExpiresAt) {
        return res.status(503).json({
          error: "Telehealth session is incomplete",
          code: "TELEHEALTH_UNAVAILABLE",
        });
      }

      let meetingToken: string;
      try {
        meetingToken = await createDailyMeetingToken({
          roomName: session.telehealthRoomName,
          expiresAt: session.telehealthRoomExpiresAt,
          isOwner: access.isOwner,
        });
      } catch {
        return res.status(503).json({
          error: "Telehealth is unavailable or not configured for HIPAA use",
          code: "TELEHEALTH_UNAVAILABLE",
        });
      }

      return res.json({
        state: "ready",
        provider: "daily",
        participant: access.participant,
        roomUrl: session.telehealthUrl,
        meetingToken,
        expiresAt: new Date(session.telehealthRoomExpiresAt).toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;