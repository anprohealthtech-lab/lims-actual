const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizePrivateKey(rawKey: string): string {
  const trimmed = rawKey.trim();

  if (trimmed.includes("-----BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }

  return atob(trimmed).replace(/\\n/g, "\n");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  if (!pem.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("QZ private key must be an unencrypted PKCS#8 key with BEGIN PRIVATE KEY header");
  }

  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function signQzRequest(request: string, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-512",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(request),
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    });
  }

  try {
    const privateKey = Deno.env.get("QZ_PRIVATE_KEY");

    if (!privateKey) {
      return new Response(JSON.stringify({
        error: "Missing QZ_PRIVATE_KEY Supabase secret",
        code: "QZ_PRIVATE_KEY_MISSING",
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const { request } = await req.json() as { request?: string };

    if (!request) {
      return new Response(JSON.stringify({ error: "Missing request payload to sign" }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    console.log("[QZ] Signing request received", {
      requestLength: request.length,
      privateKeyLength: privateKey.length,
      hasPemMarker: privateKey.includes("-----BEGIN"),
    });

    let normalizedPrivateKey: string;

    try {
      normalizedPrivateKey = normalizePrivateKey(privateKey);
    } catch (error) {
      console.error("[QZ] Private key normalization failed", error);
      return new Response(JSON.stringify({
        error: "QZ_PRIVATE_KEY is not valid PEM or base64 text",
        code: "QZ_PRIVATE_KEY_NORMALIZE_FAILED",
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    let signature: string;

    try {
      signature = await signQzRequest(request, normalizedPrivateKey);
    } catch (error) {
      console.error("[QZ] Crypto signing failed", error);
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : "QZ crypto signing failed",
        code: "QZ_SIGNING_FAILED",
        keyInfo: {
          hasPemMarker: normalizedPrivateKey.includes("-----BEGIN"),
          hasPkcs8Marker: normalizedPrivateKey.includes("-----BEGIN PRIVATE KEY-----"),
          normalizedLength: normalizedPrivateKey.length,
        },
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    console.log("[QZ] Signing request completed", {
      signatureLength: signature.length,
    });

    return new Response(JSON.stringify({ signature }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("[QZ] Failed to sign request", error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to sign QZ Tray request",
      code: "QZ_SIGN_REQUEST_FAILED",
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
