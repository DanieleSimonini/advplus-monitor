// /supabase/functions/sendAppointmentEmail/index.ts
// Invio email promemoria appuntamento con allegato .ics (SMTPS 465, stile smtp_invite)

import { SmtpClient } from "https://deno.land/x/smtp/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";
const SMTP_FROM =
  Deno.env.get("SMTP_FROM") || "Commerciale | Advisory+ <commerciale@advisoryplus.it>";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Funzioni di supporto ---
function tsForICS(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildICS({ title, description, start, end, location }: {
  title: string;
  description: string;
  start: Date;
  end: Date;
  location?: string;
}) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@advisoryplus.it`,
    `DTSTAMP:${tsForICS(new Date())}`,
    `DTSTART:${tsForICS(start)}`,
    `DTEND:${tsForICS(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    location ? `LOCATION:${location}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// --- ENTRYPOINT ---
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Validazione Secrets SMTP
    if (!isNonEmptyString(SMTP_HOST) || !isNonEmptyString(SMTP_USER) || !isNonEmptyString(SMTP_PASS)) {
      return new Response(
        JSON.stringify({ error: "SMTP non configurato: verifica SMTP_HOST, SMTP_USER, SMTP_PASS." }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    // Lettura del body
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
    } = body;

    // Controllo parametri obbligatori
    if (!isNonEmptyString(to_client_email) || !isNonEmptyString(ts_iso) || !isNonEmptyString(modalita)) {
      return new Response(
        JSON.stringify({ error: "Parametri mancanti: to_client_email, ts_iso, modalita sono obbligatori." }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    // Normalizzazione dati
    const TO = to_client_email.trim();
    const CC = isNonEmptyString(cc_advisor_email) ? cc_advisor_email.trim() : null;
    const CLIENTE = isNonEmptyString(cliente_nome) ? cliente_nome.trim() : "Cliente";
    const ADVISOR = isNonEmptyString(advisor_nome) ? advisor_nome.trim() : "Advisory+";
    const MODE = modalita.trim();
    const NOTE = String(note ?? "").trim();
    const LOC = String(location ?? "").trim();

    // Date e file ICS
    const start = new Date(ts_iso);
    const end = new Date(start.getTime() + durata_minuti * 60_000);
    const titoloICS = `Appuntamento Advisory+ con ${CLIENTE}`;
    const descrizioneICS = `Modalità: ${MODE}\nNote: ${NOTE || "-"}`;
    const ics = buildICS({ title: titoloICS, description: descrizioneICS, start, end, location: LOC });

    // Corpo email
    const subject = `Promemoria appuntamento – ${CLIENTE}`;
    const dataStr = start.toLocaleDateString("it-IT");
    const oraStr = start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const html =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#0f172a">
        <p>Gentile ${CLIENTE},</p>
        <p>Le ricordiamo l’appuntamento fissato per il giorno <b>${dataStr}</b> alle ore <b>${oraStr}</b> in modalità <b>${MODE}</b>.</p>
        <p><b>Note:</b> ${NOTE || "-"}</p>
        <p>Cordiali saluti,<br>${ADVISOR}<br>Advisory+</p>
      </div>`;

    // --- INVIO MAIL (TLS implicito su 465) ---
    const client = new SmtpClient();
    await client.connectTLS({
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      username: SMTP_USER,
      password: SMTP_PASS,
    });

    const message: Record<string, unknown> = {
      from: SMTP_FROM,
      to: TO,
      subject,
      content: html,
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

    // Risposta OK
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
