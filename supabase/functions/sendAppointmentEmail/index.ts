// supabase/functions/sendAppointmentEmail/index.ts
// Deno Edge Function
// Invia email promemoria appuntamento con allegato .ics
// SMTP: mail.advisoryplus.it:465 (SSL)
// Mittente: "Commerciale | Advisory+" <commerciale@advisoryplus.it>

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

// ---------- Config ----------
const SMTP_HOST = "mail.advisoryplus.it";
const SMTP_PORT = 465; // SSL
const SMTP_USER = "commerciale@advisoryplus.it";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? ""; // <-- setta via supabase secrets
const FROM_NAME = "Commerciale | Advisory+";
const FROM_EMAIL = "commerciale@advisoryplus.it";

// ---------- Helpers ----------
function formatICSDateUTC(date: Date) {
  // Rende form: YYYYMMDDTHHMMSSZ
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}

function buildICS(params: {
  title: string;
  description: string;
  start: Date;
  end: Date;
  location?: string;
  uid?: string;
}) {
  const uid = params.uid ?? `${Date.now()}@advisoryplus.it`;
  const dtstamp = formatICSDateUTC(new Date());
  const dtstart = formatICSDateUTC(params.start);
  const dtend = formatICSDateUTC(params.end);
  const summary = params.title.replace(/\n/g, " ");
  const desc = params.description.replace(/\n/g, "\\n");
  const loc = (params.location ?? "").replace(/\n/g, " ");

  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//AdvisoryPlus//CRM//IT",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    loc ? `LOCATION:${loc}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

function renderEmailText(params: {
  cliente_nome: string;
  data: string;
  ora: string;
  modalita: string;
  note: string;
  advisor_nome?: string;
}) {
  const { cliente_nome, data, ora, modalita, note, advisor_nome } = params;
  const firmatario = advisor_nome || "Advisory+";
  const text = [
    `Gentile ${cliente_nome},`,
    ``,
    `Le ricordiamo l’appuntamento fissato per il giorno ${data} alle ore ${ora} in modalità ${modalita}.`,
    ``,
    `Note: ${note || "-"}`,
    ``,
    `Cordiali saluti,`,
    `${firmatario}`,
    `Advisory+`,
  ].join("\n");

  const html = `
  <p>Gentile ${cliente_nome},</p>
  <p>Le ricordiamo l’appuntamento fissato per il giorno <b>${data}</b> alle ore <b>${ora}</b> in modalità <b>${modalita}</b>.</p>
  <p><b>Note:</b> ${note ? note.replace(/\n/g, "<br/>") : "-"}</p>
  <p>Cordiali saluti,<br/>
  ${firmatario}<br/>
  Advisory+</p>
  `;

  return { text, html };
}

// ---------- HTTP handler ----------
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const {
      // destinatari
      to_client_email,         // string (obbligatorio)
      cc_advisor_email,        // string | undefined (junior/TL)
      // dati cliente/advisor per testo
      cliente_nome,            // string (es. "Mario Rossi")
      advisor_nome,            // string (es. "Giulia Bianchi")
      // dati appuntamento
      ts_iso,                  // string (ISO, es. "2025-11-03T10:30:00+01:00")
      durata_minuti = 60,      // default 60
      modalita,                // string (es. "In presenza", "Video", "Telefono")
      note = "",               // string
      location = "",           // opzionale
      // oggetto e titolo
      subject,                 // string opzionale - se non dato, genero io
      title,                   // string opzionale per ICS - se non dato, genero io
    } = await req.json();

    if (!to_client_email || !ts_iso || !modalita) {
      return new Response(JSON.stringify({
        error: "Parametri mancanti: to_client_email, ts_iso, modalita sono obbligatori.",
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // parse date
    const startLocal = new Date(ts_iso);
    if (isNaN(startLocal.getTime())) {
      return new Response(JSON.stringify({ error: "ts_iso non valido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const endLocal = new Date(startLocal.getTime() + durata_minuti * 60_000);

    // formattazione "umana" per email (usa la timezone del server — se vuoi, passami anche la tz)
    const it = new Intl.DateTimeFormat("it-IT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const itTime = new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const data_str = it.format(startLocal);     // es: "lunedì 03 novembre 2025"
    const ora_str = itTime.format(startLocal);  // es: "10:30"

    const oggetto = subject ?? `Promemoria appuntamento – ${cliente_nome || "Cliente"}`;
    const titoloICS = title ?? `Appuntamento Advisory+ con ${cliente_nome || "Cliente"}`;

    const descrizioneICS =
      `Modalità: ${modalita}\nNote: ${note || "-"}`;

    // Email body
    const { text, html } = renderEmailText({
      cliente_nome: cliente_nome || "Cliente",
      data: data_str,
      ora: ora_str,
      modalita,
      note,
      advisor_nome,
    });

    // ICS
    const icsContent = buildICS({
      title: titoloICS,
      description: descrizioneICS,
      start: new Date(startLocal.toISOString()), // convert to UTC inside builder
      end: new Date(endLocal.toISOString()),
      location,
    });

    // SMTP client (SSL su 465)
    const client = new SmtpClient();

    await client.connectTLS({
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      username: SMTP_USER,
      password: SMTP_PASS,
    });

    const fromHeader = `${FROM_NAME} <${FROM_EMAIL}>`;
    const toList = [to_client_email];
    const ccList = cc_advisor_email ? [cc_advisor_email] : [];

    await client.send({
      from: fromHeader,
      to: toList,
      cc: ccList.length ? ccList : undefined,
      subject: oggetto,
      content: html,
      html: true,
      attachments: [
        {
          // Outlook/Google lo riconoscono e propongono "Aggiungi al calendario"
          content: icsContent,
          contentType: "text/calendar; method=REQUEST; charset=UTF-8",
          filename: "appuntamento.ics",
        },
        {
          // Fallback: invio anche versione testo piano come .txt (opzionale)
          content: text,
          contentType: "text/plain; charset=UTF-8",
          filename: "promemoria.txt",
        },
      ],
    });

    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
