// Purpose: Self-service PIN reset for patient portal users.
// Route: POST /patient-forgot-pin
// Body: { phone: string }
// Auth: none (public) — the new PIN is never returned to the caller; it is only
// delivered via the lab's connected WhatsApp session to the registered number.
// The password is updated ONLY after the WhatsApp send succeeds, so a failed
// send never locks the patient out of their current PIN.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Minimum gap between self-service resets for one patient
const RESET_COOLDOWN_MS = 2 * 60 * 1000;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Mirror of frontend WhatsAppAPI.formatPhoneNumber (assumes +91 for 10-digit numbers)
function formatPhoneForSend(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.substring(1);
  return digits;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { phone } = await req.json();
    const cleanDigits = String(phone || '').replace(/\D/g, '');

    if (cleanDigits.length < 10) {
      return json({ success: false, reason: 'invalid_phone', message: 'Enter a valid mobile number.' }, 400);
    }
    const last10 = cleanDigits.slice(-10);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Find portal-enabled patients whose phone ends with the given number.
    // ilike on the last 4 digits narrows the scan; exact match happens in JS
    // because stored phone formats vary (spaces, +91, dashes).
    const { data: candidates } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone, lab_id, patient_auth_id, portal_pin_reset_at, portal_access_enabled')
      .eq('portal_access_enabled', true)
      .not('patient_auth_id', 'is', null)
      .ilike('phone', `%${last10.slice(-4)}%`)
      .limit(100);

    const patient = (candidates || []).find(
      (p) => String(p.phone || '').replace(/\D/g, '').slice(-10) === last10
    );

    if (!patient) {
      return json({
        success: false,
        reason: 'not_found',
        message: 'No portal access found for this mobile number. Please contact your lab.',
      }, 404);
    }

    // Throttle repeated resets
    if (patient.portal_pin_reset_at) {
      const elapsed = Date.now() - new Date(patient.portal_pin_reset_at).getTime();
      if (elapsed < RESET_COOLDOWN_MS) {
        return json({
          success: false,
          reason: 'too_soon',
          message: 'A PIN was sent recently. Please wait a couple of minutes and check WhatsApp.',
        }, 429);
      }
    }

    // Resolve the lab's connected WhatsApp sender
    const { data: lab } = await supabaseAdmin
      .from('labs')
      .select('name, whatsapp_user_id')
      .eq('id', patient.lab_id)
      .single();

    if (!lab?.whatsapp_user_id) {
      return json({
        success: false,
        reason: 'whatsapp_unavailable',
        message: 'Automatic PIN reset is not available. Please contact your lab to reset your PIN.',
      });
    }

    const pin = generatePin();
    const message =
      `Hello ${patient.name},\n\nYour new patient portal PIN is *${pin}*.\n\n` +
      `Login: https://app.limsapp.in/patient/login\n` +
      `Use your registered mobile number and this PIN.\n\n` +
      `If you did not request this, please contact ${lab.name || 'your lab'}.`;

    // Send FIRST — only apply the new PIN if delivery succeeded
    const waBase = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://app.limsapp.in/whatsapp';
    const waKey = Deno.env.get('WHATSAPP_API_KEY') || 'whatsapp-lims-secure-api-key-2024';

    let sendOk = false;
    try {
      const waRes = await fetch(`${waBase}/api/external/messages/send-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': waKey },
        body: JSON.stringify({
          userId: lab.whatsapp_user_id,
          phoneNumber: formatPhoneForSend(patient.phone),
          message,
        }),
      });
      const waJson = await waRes.json().catch(() => ({}));
      sendOk = waRes.ok && waJson?.success !== false;
      if (!sendOk) console.error('[FORGOT-PIN] WhatsApp send failed:', waRes.status, waJson);
    } catch (err) {
      console.error('[FORGOT-PIN] WhatsApp send error:', err);
    }

    if (!sendOk) {
      return json({
        success: false,
        reason: 'send_failed',
        message: 'Could not send a new PIN right now. Please contact your lab to reset it.',
      });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      patient.patient_auth_id,
      { password: pin }
    );

    if (updateError) {
      console.error('[FORGOT-PIN] Password update failed after send:', updateError);
      return json({
        success: false,
        reason: 'reset_failed',
        message: 'PIN reset failed. Please contact your lab.',
      }, 500);
    }

    await supabaseAdmin
      .from('patients')
      .update({ portal_pin_reset_at: new Date().toISOString() })
      .eq('id', patient.id);

    console.log(`[FORGOT-PIN] PIN reset + WhatsApp sent for patient ${patient.id}`);

    return json({
      success: true,
      message: `A new PIN has been sent via WhatsApp to your number ending ${last10.slice(-4)}.`,
    });

  } catch (error) {
    console.error('[FORGOT-PIN] ERROR:', error);
    return json({ success: false, reason: 'error', message: 'Something went wrong. Please try again.' }, 500);
  }
});
