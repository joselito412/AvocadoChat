import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// La decodificación ya no es necesaria aquí, pero la mantenemos por consistencia
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

// --- CONFIGURACIÓN DE GOOGLE CLOUD (Se lee de los Secretos de Supabase) ---
// NOTA: Debes haber configurado estos SECRETOS en el Dashboard de Supabase
const GCP_PROJECT_ID = Deno.env.get('GCP_PROJECT_ID'); 
const GCP_SERVICE_ACCOUNT_EMAIL = Deno.env.get('GCP_SERVICE_ACCOUNT_EMAIL');
const GCP_WIF_PROVIDER_ID = Deno.env.get('GCP_WIF_PROVIDER_ID'); 
const WIF_POOL_NAME = 'avocadowhatsappapi'; 
const PUBSUB_TOPIC = 'new-user-signups'; 
const PUBSUB_ENDPOINT = `https://pubsub.googleapis.com/v1/projects/${GCP_PROJECT_ID}/topics/${PUBSUB_TOPIC}:publish`;
const SUPABASE_OIDC_TOKEN = Deno.env.get('SUPABASE_OIDC_TOKEN'); 

// CLAVE DE VERIFICACIÓN DE META: Debes configurar este valor como un SECRETO en Supabase
const META_VERIFY_TOKEN = Deno.env.get('META_VERIFY_TOKEN') || 'tu_token_secreto_de_meta';


// Lógica de Autenticación WIF (Sin Cambios, Ya es Correcta)
async function getGoogleAccessToken(): Promise<string> {
    if (!SUPABASE_OIDC_TOKEN || !GCP_PROJECT_ID || !GCP_SERVICE_ACCOUNT_EMAIL || !GCP_WIF_PROVIDER_ID) {
        throw new Error("Faltan secretos de entorno de Google Cloud para WIF.");
    }
    // ... (Mismo código de intercambio de token) ...
    const TOKEN_EXCHANGE_URL = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`;
    const providerResource = `projects/${GCP_PROJECT_ID}/locations/global/workloadIdentityPools/${WIF_POOL_NAME}/providers/${GCP_WIF_PROVIDER_ID}`;

    const exchangeResponse = await fetch(TOKEN_EXCHANGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            scope: ['https://www.googleapis.com/auth/pubsub'],
            assertion: SUPABASE_OIDC_TOKEN,
            provider: providerResource
        }),
    });
    
    const exchangeData = await exchangeResponse.json();
    if (!exchangeResponse.ok || !exchangeData.accessToken) {
        throw new Error(`Fallo en intercambio de token: ${exchangeData.error?.message || exchangeResponse.statusText}`);
    }
    return exchangeData.accessToken;
}


async function publishToPubSub(userData: any): Promise<Response> {
    // ... (Mismo código de publicación a Pub/Sub, usando getGoogleAccessToken) ...
    const token = await getGoogleAccessToken();
    const messageDataB64 = btoa(JSON.stringify(userData));

    const pubsubPayload = {
        messages: [{ data: messageDataB64 }],
    };

    const response = await fetch(PUBSUB_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`, 
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(pubsubPayload),
    });

    return response;
}


// Handler principal de la Edge Function
serve(async (req) => {
    try {
        // ----------------------------------------------------
        // A. LÓGICA DE VERIFICACIÓN DE META (GET)
        // ----------------------------------------------------
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const mode = url.searchParams.get("hub.mode");
            const token = url.searchParams.get("hub.verify_token");
            const challenge = url.searchParams.get("hub.challenge");

            if (mode === "subscribe" && token === META_VERIFY_TOKEN && challenge) {
                // Éxito: Meta verificó el webhook y espera la respuesta 'challenge'
                return new Response(challenge, { status: 200 });
            } else {
                // Fallo en la verificación (token incorrecto o modo incorrecto)
                return new Response("Verification token mismatch or mode not 'subscribe'.", { status: 403 });
            }
        }

        // ----------------------------------------------------
        // B. LÓGICA DE PROCESAMIENTO DE MENSAJE (POST)
        // ----------------------------------------------------
        const whatsappEvent = await req.json();
        
        // Extracción de datos (el primer mensaje de la lista de eventos)
        const message = whatsappEvent.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        const senderId = message?.from;
        const messageText = message?.text?.body;
        
        if (!senderId) {
             return new Response("Invalid message format: No sender ID.", { status: 400 });
        }

        // Crear el payload que la Cloud Function Python espera para la inserción
        const userData = {
            whatsappId: senderId,
            phone: senderId, // Usamos el ID como número de teléfono (asumido)
            email: `${senderId}@tempchat.com`, 
            full_name: `User ${senderId}`,
            role: 'client', // Requisito de la tabla users
            message: messageText || "No text body.", 
            timestamp: new Date().toISOString()
        };

        // 3. Publicar el mensaje en Pub/Sub (Desacoplar)
        const pubsubResponse = await publishToPubSub(userData);

        if (!pubsubResponse.ok) {
            console.error(`Fallo en Pub/Sub: ${pubsubResponse.status} - ${await pubsubResponse.text()}`);
            // NOTA: Se devuelve 200/202 para que Meta no reintente el webhook.
            return new Response(JSON.stringify({ status: "Error publishing to GCP" }), { status: 202 });
        }
        
        // 4. Enviar respuesta inmediata a Meta
        return new Response(JSON.stringify({ status: "Message received and queued" }), {
            status: 200,
        });

    } catch (error) {
        console.error('Error fatal en Edge Function:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
        });
    }
});