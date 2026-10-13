import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import { Video, VideoOff } from "lucide-react";

import {
  ensureTelehealthSession,
  TelehealthSessionError,
  type TelehealthSession,
} from "./telehealth-api";
import "./telehealth-visit.css";

type VisitState = "idle" | "preparing" | "ready" | "unavailable" | "ended";

type Props = {
  appointment: Record<string, any> | null | undefined;
  editable?: boolean;
  enabled?: boolean;
  autoStart?: boolean;
};

export function TelehealthVisit({
  appointment,
  editable = false,
  enabled = true,
  autoStart = false,
}: Props) {
  const appointmentId = String(appointment?.id ?? "");
  const isTelehealth = String(appointment?.location_type ?? "") === "telehealth";
  const [state, setState] = useState<VisitState>("idle");
  const [session, setSession] = useState<TelehealthSession | null>(null);
  const [message, setMessage] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callRef = useRef<DailyCall | null>(null);
  const autoStartedRef = useRef(false);

  const stopCall = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    if (!call) return;
    try { await call.leave(); } catch { /* call may already be left */ }
    try { await call.destroy(); } catch { /* frame may already be destroyed */ }
  }, []);

  useEffect(() => {
    return () => { void stopCall(); };
  }, [stopCall]);

  useEffect(() => {
    setState("idle");
    setSession(null);
    setMessage("");
    autoStartedRef.current = false;
    void stopCall();
  }, [appointmentId, stopCall]);

  const startVisit = useCallback(async () => {
    if (!appointmentId || !isTelehealth || !enabled || state === "preparing") return;
    setState("preparing");
    setMessage("");
    try {
      const next = await ensureTelehealthSession(appointmentId);
      setSession(next);
      setState("ready");
    } catch (error) {
      setState("unavailable");
      if (error instanceof TelehealthSessionError && error.code === "CHECK_IN_REQUIRED") {
        setMessage("Complete and submit pre-visit check-in before joining the video visit.");
      } else {
        setMessage(error instanceof Error ? error.message : "Telehealth is unavailable.");
      }
    }
  }, [appointmentId, enabled, isTelehealth, state]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || !enabled || !isTelehealth) return;
    autoStartedRef.current = true;
    void startVisit();
  }, [autoStart, enabled, isTelehealth, startVisit]);

  useEffect(() => {
    if (!session || !containerRef.current || callRef.current) return;
    let cancelled = false;
    const container = containerRef.current;
    const activeSession = session;

    async function join() {
      try {
        const { default: Daily } = await import("@daily-co/daily-js");
        if (cancelled || !container) return;
        const call = Daily.createFrame(container, {
          showLeaveButton: true,
          iframeStyle: {
            width: "100%",
            height: "100%",
            border: "0",
            borderRadius: "10px",
          },
        });
        callRef.current = call;
        call.on("left-meeting", () => {
          callRef.current = null;
          setState("ended");
          setSession(null);
          void call.destroy();
        });
        call.on("error", () => {
          setMessage("The video visit encountered a connection error. You can try joining again.");
        });
        await call.join({ url: activeSession.roomUrl, token: activeSession.meetingToken });
      } catch (error) {
        if (!cancelled) {
          setState("unavailable");
          setMessage(error instanceof Error ? error.message : "Unable to start the video visit.");
          await stopCall();
        }
      }
    }

    void join();
    return () => { cancelled = true; };
  }, [session, stopCall]);

  if (!appointment || !isTelehealth) return null;

  if (!enabled) {
    return (
      <section className="telehealth-visit-card waiting" aria-label="Telehealth visit">
        <div className="telehealth-visit-heading">
          <Video size={18} />
          <div><strong>Video visit</strong><span>Complete pre-visit check-in to join.</span></div>
        </div>
      </section>
    );
  }

  return (
    <section className={`telehealth-visit-card ${state}`} aria-label="Telehealth visit">
      <div className="telehealth-visit-heading">
        {state === "unavailable" ? <VideoOff size={18} /> : <Video size={18} />}
        <div>
          <strong>{state === "ready" ? "Video visit ready" : state === "ended" ? "Video visit ended" : "Video visit"}</strong>
          <span>{editable ? "Secure video is managed by THERASSISTANT." : "Your secure visit stays inside the patient portal."}</span>
        </div>
        {state !== "ready" && (
          <button type="button" className="thera-action" disabled={state === "preparing"} onClick={() => void startVisit()}>
            {state === "preparing" ? "Preparing…" : state === "ended" ? "Rejoin Video Visit" : "Join Video Visit"}
          </button>
        )}
      </div>

      {message ? <p className="telehealth-visit-message" role="status">{message}</p> : null}
      {state === "ready" ? <div ref={containerRef} className="telehealth-visit-frame" aria-label="Secure video visit" /> : null}
    </section>
  );
}