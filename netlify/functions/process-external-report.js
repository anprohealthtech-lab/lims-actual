
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

async function handler(req, context) {
    if (req.method === "OPTIONS") {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: "ok",
        };
    }

    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceKey) {
            console.error("Missing Supabase credentials in Netlify env");
            return {
                statusCode: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Configuration Error: Missing Supabase URL or Key" }),
            };
        }

        console.log(`Proxying to: ${supabaseUrl}/functions/v1/process-external-report`);

        const response = await fetch(`${supabaseUrl}/functions/v1/process-external-report`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
            },
            body: req.body,
        });

        const data = await response.json();
        console.log("Supabase Function Response Status:", response.status);

        return {
            statusCode: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error("Error in process-external-report proxy:", error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ error: `Proxy Error: ${error.message}` }),
        };
    }
}

export { handler };
