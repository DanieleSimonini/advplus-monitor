// /supabase/functions/sendAppointmentEmail/index.ts
// Invio email promemoria appuntamento con allegato .ics (SMTPS su 465)

import { SmtpClient } from "https://deno.land/x/smtp/mod.ts";

// --- ENV / SMTP ---
const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465"); // 465
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";
const SMTP_FROM =
  Deno.env.get("SMTP_FROM") || "Commerciale | Advisory+ <commerciale@advisoryplus.it>";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Helpers ---
function tsForICS(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildICS(params: {
  title: string;
  description: string;
  start: Date;
  end: Date;
  location?: string;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@advisoryplus.it`,
    `DTSTAMP:${tsForICS(new Date())}`,
    `DTSTART:${tsForICS(params.start)}`,
    `DTEND:${tsForICS(params.end)}`,
    `SUMMARY:${String(params.title).replace(/\n/g, " ")}`,
    `DESCRIPTION:${String(params.description).replace(/\n/g, "\\n")}`,
    params.location ? `LOCATION:${String(params.location).replace(/\n/g, " ")}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter(Boolean).join("\r\n");
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Verifica config SMTP minima
    if (!isNonEmptyString(SMTP_HOST) || !isNonEmptyString(SMTP_USER) || !isNonEmptyString(SMTP_PASS)) {
      return new Response(
        JSON.stringify({ error: "SMTP non configurato: verifica SMTP_HOST, SMTP_USER, SMTP_PASS." }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      to_client_email,
      cc_advisor_email,
      cliente_nome,
      advisor_nome,
      ts_iso,
      durata_minuti = 60,
      modalita,
      note = "",
      location = "",
      subject: subjectIn,
      title: titleIn,
    } = body;

    // Guard essenziali (evita 500 e strani errori della lib)
    if (!isNonEmptyString(to_client_email) || !isNonEmptyString(ts_iso) || !isNonEmptyString(modalita)) {
      return new Response(
        JSON.stringify({
          error: "Parametri mancanti: to_client_email, ts_iso, modalita sono obbligatori.",
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    // Normalizzazioni sicure
    const TO = String(to_client_email).trim();
    const CC = isNonEmptyString(cc_advisor_email) ? String(cc_advisor_email).trim() : null;
    const CLIENTE = isNonEmptyString(cliente_nome) ? cliente_nome.trim() : "Cliente";
    const ADVISOR = isNonEmptyString(advisor_nome) ? advisor_nome.trim() : "Advisory+";
    const MODE = String(modalita).trim();
    const NOTE = String(note ?? "").trim();
    const LOC = String(location ?? "").trim();

    // Date
    const start = new Date(ts_iso);
    if (isNaN(start.getTime())) {
      return new Response(
        JSON.stringify({ error: "ts_iso non è una data valida (ISO 8601)." }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } },
      );
    }
    const end = new Date(start.getTime() + Number(durata_minuti) * 60_000);

    // Contenuti email + ICS
    const titoloICS = isNonEmptyString(titleIn) ? titleIn : `Appuntamento Advisory+ con ${CLIENTE}`;
    const descrizioneICS = `Modalità: ${MODE}\nNote: ${NOTE || "-"}`;
    const ics = buildICS({ title: titoloICS, description: descrizioneICS, start, end, location: LOC });

    const subject = isNonEmptyString(subjectIn) ? subjectIn : `Promemoria appuntamento – ${CLIENTE}`;
    const dataStr = start.toLocaleDateString("it-IT");
    const oraStr = start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const html =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#0f172a">
        <p>Gentile ${CLIENTE},</p>
        <p>Le ricordiamo l’appuntamento fissato per il giorno <b>${dataStr}</b> alle ore <b>${oraStr}</b> in modalità <b>${MODE}</b>.</p>
        <p><b>Note:</b> ${NOTE || "-"}</p>
        <p>Cordiali saluti,<br>${ADVISOR}<br>Advisory+</p>
      </div>`;

    // ---------- INVIO SMTP su 465 (TLS implicito) ----------
    const client = new SmtpClient();
    await client.connectTLS({
      hostname: SMTP_HOST,     // es. mail.advisoryplus.it
      port: SMTP_PORT,         // 465
      username: SMTP_USER,
      password: SMTP_PASS,
    });

    const message: Record<string, unknown> = {
      from: SMTP_FROM,
      to: TO,
      subject,
      content: html, // HTML come stringa (questa lib lo invia come text/html)
      attachments: [
        {
          filename: "appuntamento.ics",
          content: String(ics),
          contentType: "text/calendar; method=REQUEST; charset=utf-8",
        },
      ],
    };
    if (CC) message.cc = CC;

    await client.send(message);
    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (e) {
    console.error("sendAppointmentEmail error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
});
