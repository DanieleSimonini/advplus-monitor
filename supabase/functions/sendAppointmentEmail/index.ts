// /supabase/functions/sendAppointmentEmail/index.ts
// Invio email appuntamento con anteprima meeting in Outlook Classic (inline) + allegato ICS
// Fix: elimina artefatti '=20' (forza 7bit via MIME raw), orari corretti (Europe/Rome + VTIMEZONE)
// Deno v2 – denomailer

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

const RAW_SMTP_FROM = Deno.env.get("SMTP_FROM") || SMTP_USER || "";
const SMTP_FROM = RAW_SMTP_FROM.match(/<([^>]+)>/)?.[1]?.trim() ?? RAW_SMTP_FROM.trim();

const TZID = "Europe/Rome";

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function b64(s: string) {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).btoa(unescape(encodeURIComponent(s)));
}
function pad(n: number) { return String(n).padStart(2, "0"); }

function fmtDateUTC(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function fmtLocalTZID(d: Date) {
  // YYYYMMDDTHHMMSS secondo l'orario locale fornito dall'oggetto Date
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function foldIcs(ics: string) {
  // RFC5545: 75 ottetti per linea, continuation con una singola SP
  const out: string[] = [];
  for (const rawLine of ics.split(/\r?\n/)) {
    let line = rawLine;
    while (new TextEncoder().encode(line).length > 75) {
      let cut = 75;
      while (new TextEncoder().encode(line.slice(0, cut)).length > 75) cut--;
      out.push(line.slice(0, cut));
      line = " " + line.slice(cut);
    }
    out.push(line);
  }
  return out.join("\\r\\n");
}

function sanitize7bit(s: string) {
  // Rimuove spazi e tab finali per evitare '=20' in quoted-printable (non lo useremo comunque)
  return s.replace(/[ \\t]+$/gm, "");
}

// -----------------------------------------------------------------------------
// ICS builder
// -----------------------------------------------------------------------------
function buildICS(params: {
  uid: string;
  subject: string;
  description: string;
  location?: string;
  start: Date;
  end: Date;
  organizerEmail: string;
  attendeeEmail: string;
}) {
  const {
    uid, subject, description, location = "", start, end, organizerEmail, attendeeEmail,
  } = params;

  const ics = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Advisory+//Meetings//IT",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    "X-LIC-LOCATION:Europe/Rome",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmtDateUTC(new Date())}`,
    `DTSTART;TZID=${TZID}:${fmtLocalTZID(start)}`,
    `DTEND;TZID=${TZID}:${fmtLocalTZID(end)}`,
    `SUMMARY:${subject}`,
    `LOCATION:${location}`,
    `ORGANIZER:MAILTO:${organizerEmail}`,
    `ATTENDEE;CN=${attendeeEmail};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${attendeeEmail}`,
    `DESCRIPTION:${sanitize7bit(description).replace(/\\r?\\n/g, "\\\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\\r\\n");

  return foldIcs(ics) + "\\r\\n";
}

// -----------------------------------------------------------------------------
// MIME email (raw) compliant per Outlook meeting preview
// -----------------------------------------------------------------------------
function buildRawEmail(args: {
  to: string;
  subject: string;
  fromDisplay?: string;
  text: string;
  html: string;
  ics: string;
}) {
  const { to, subject, fromDisplay = RAW_SMTP_FROM || SMTP_FROM, text, html, ics } = args;
  const boundaryMixed = "b1_" + crypto.randomUUID();
  const boundaryAlt = "b2_" + crypto.randomUUID();

  const text7bit = sanitize7bit(text);
  const htmlB64 = b64(html);

  const raw =
`From: ${fromDisplay}
To: ${to}
Subject: ${subject}
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundaryMixed}"

--${boundaryMixed}
Content-Type: multipart/alternative; boundary="${boundaryAlt}"

--${boundaryAlt}
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 7bit

${text7bit}

--${boundaryAlt}
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: base64

${htmlB64}

--${boundaryAlt}
Content-Type: text/calendar; method=REQUEST; charset=UTF-8; name="appuntamento.ics"
Content-Transfer-Encoding: 7bit
Content-Class: urn:content-classes:calendarmessage

${ics}
--${boundaryAlt}--

--${boundaryMixed}
Content-Type: text/calendar; method=REQUEST; charset=UTF-8; name="appuntamento.ics"
Content-Transfer-Encoding: 7bit
Content-Disposition: attachment; filename="appuntamento.ics"

${ics}
--${boundaryMixed}--`;

  return raw;
}

// -----------------------------------------------------------------------------
// HTTP handler (Supabase Edge Function style)
// -----------------------------------------------------------------------------
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const body = await req.json();

    // Compat: accettiamo sia 'start'/'end' ISO string che 'startISO'/'endISO'.
    const startISO = body.startISO ?? body.start;
    const endISO = body.endISO ?? body.end;

    const start = new Date(startISO);
    const end = new Date(endISO);

    const to = body.to;
    const subject = body.subject ?? "Appuntamento";
    const location = body.location ?? "";
    const organizerEmail = body.organizerEmail ?? SMTP_FROM;
    const attendeeEmail = body.attendeeEmail ?? to;
    const description = body.text ?? body.description ?? "";
    const html = body.html ?? `<p>${description.replace(/\\n/g, "<br>")}</p>`;
    const text = body.text ?? (body.html ? body.html.replace(/<[^>]+>/g, "") : description);
    const uid = body.uid ?? crypto.randomUUID();

    const ics = buildICS({
      uid, subject, description, location, start, end, organizerEmail, attendeeEmail,
    });

    const raw = buildRawEmail({
      to,
      subject,
      text,
      html,
      ics,
      fromDisplay: RAW_SMTP_FROM || SMTP_FROM,
    });

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    await client.send({ raw });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  } catch (e) {
    console.error("sendAppointmentEmail error:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { "Content-Type": "application/json", ...cors } });
  }
});
