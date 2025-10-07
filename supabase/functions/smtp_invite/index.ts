// Deno Edge Function - smtp_invite
// Invio invito via SMTP + generateLink('invite') con Service Role

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/smtp/mod.ts";

type Role = 'Admin' | 'Team Lead' | 'Junior';

type Payload = {
  email: string;
  role: Role;
  full_name?: string;
};

// ==== ENV ====
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SMTP_HOST   = Deno.env.get("SMTP_HOST")!;
const SMTP_PORT   = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER   = Deno.env.get("SMTP_USER")!;
const SMTP_PASS   = Deno.env.get("SMTP_PASS")!;
const SMTP_FROM   = Deno.env.get("SMTP_FROM") || "noreply@example.com";
const SMTP_SECURE = (Deno.env.get("SMTP_SECURE") || "true").toLowerCase() === "true";

// Helper CORS
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const body: Payload = await req.json().catch(() => ({} as any));
    if (!body.email || !body.role) {
      return new Response(JSON.stringify({ error: "Missing email or role" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const email = body.email.trim().toLowerCase();
    const fullName = (body.full_name || "").trim();
    const role: Role = body.role;

    // Supabase admin (Service Role)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) Upsert in advisors (se non esiste)
    //    Nota: user_id resta null finché l'invitato non effettua il primo login
    const { data: advExists } = await admin
      .from("advisors")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (!advExists) {
      await admin.from("advisors").insert({
        email,
        full_name: fullName || null,
        role,
      });
    } else {
      // aggiorna eventuale ruolo/nome se diverso
      await admin
        .from("advisors")
        .update({ full_name: fullName || null, role })
        .eq("email", email);
    }

    // 2) Genera link di invito (l’utente sceglierà la password al primo accesso)
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
    });
    if (linkErr) throw linkErr;

    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) throw new Error("Impossibile generare il link di invito");

    // 3) Invia email via SMTP
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: SMTP_SECURE, // true per 465
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    const subject = `Invito a registrarti su GuideUp`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.4;color:#0f172a">
        <h2 style="margin:0 0 12px 0">Benvenuto${fullName ? `, ${fullName}` : ""}!</h2>
        <p>Hai ricevuto un invito ad accedere alla piattaforma <strong>GuideUp</strong>.</p>
        <p>Clicca il pulsante seguente per completare la registrazione e impostare la password:</p>
        <p style="margin:20px 0">
          <a href="${actionLink}" target="_blank"
             style="background:#0b57d0;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">
            Accetta l'invito
          </a>
        </p>
        <p style="font-size:14px;color:#475569">Se il pulsante non funziona, copia e incolla questo link nel browser:<br/>
          <span style="word-break:break-all">${actionLink}</span>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
        <p style="font-size:13px;color:#64748b">Se non ti aspettavi questa email, puoi ignorarla.</p>
      </div>
    `;

    await client.send({
      from: SMTP_FROM, // es: 'Advisory+ | Commerciale <commerciale@advisoryplus.it>'
      to: email,
      subject,
      content: html,
    });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
});
