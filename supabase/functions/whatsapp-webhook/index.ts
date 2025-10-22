// supabase/functions/whatsapp-webhook/index.ts

import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
// Cliente de Supabase (uso de ESM para compatibilidad con Deno).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4'; 
// Cliente del Modelo de Lenguaje (usar el que corresponda: OpenAI, Gemini, etc.).
// import { OpenAI } from 'https://deno.land/x/openai@v4.49.1/mod.ts'; 

// --- 1. CONFIGURACIÓN E INICIALIZACIÓN ---

// Variables de Entorno CRÍTICAS (deben estar configuradas en Supabase Dashboard).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; 
const META_VERIFY_TOKEN = Deno.env.get('META_VERIFY_TOKEN')!;
const WHATSAPP_API_TOKEN = Deno.env.get('WHATSAPP_API_TOKEN')!;
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!;
// const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!; 

// Inicialización del cliente Supabase con la Service Role Key para by-pass de RLS.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY); 
// Inicialización del cliente LLM (descomentar y usar el cliente apropiado).
// const openai = new OpenAI({ apiKey: OPENAI_API_KEY }); 


// ----------------------------------------------------------------------
// --- 2. FUNCIONES DE SERVICIO CORE (Implementaciones Reales) ---
// ----------------------------------------------------------------------

/** Servicio de Mensajería: Implementa la llamada real a la API de Meta para responder al usuario. */
async function sendWhatsappMessage(phoneNumber: string, message: string): Promise<void> {
    const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: { body: message }
    };

    const response = await fetch(`https://graph.whatsapp.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`, 
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        // Manejo de errores CRÍTICO: Registrar el fallo en el envío de Meta.
        const errorData = await response.json();
        console.error(`Error de Meta API al enviar:`, errorData);
        throw new Error('Fallo al enviar mensaje a WhatsApp.');
    }
}

/** Utilería de Trazabilidad: Registra la interacción del LLM en la tabla 'ai_interactions'. */
async function logAIInteraction(
    conversationId: string, 
    modelUsed: string, 
    prompt: string, 
    responseText: string, 
    ragIds: string[], 
    costTokens: number
): Promise<void> {
    const { error } = await supabase
        .from('ai_interactions')
        .insert({
            conversation_id: conversationId,
            llm_model_used: modelUsed,
            prompt_used: prompt,
            response_text: responseText,
            rag_fragments_ids: ragIds,
            cost_in_tokens: costTokens,
        });

    if (error) {
        // La interacción se completó, pero el log falló (Advertencia de TRAZABILIDAD).
        console.warn('ADVERTENCIA: Fallo al registrar ai_interactions:', error);
    }
}


/** Función de RAG: Llama a la RPC `match_legal_documents` para la búsqueda vectorial. */
async function matchLegalDocuments(query: string) {
    // 1. Generar el embedding de la consulta del usuario (requiere llamada al LLM Client).
    // const embeddingResponse = await openai.embeddings.create({ model: "text-embedding-3-small", input: query });
    // const queryEmbedding = embeddingResponse.data[0].embedding;

    const queryEmbedding = Array(1536).fill(Math.random()); // MOCK para la búsqueda vectorial
    
    // 2. Llamada a la RPC de PostgreSQL.
    const { data, error } = await supabase.rpc('match_legal_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7, 
        match_count: 3 
    });

    if (error) {
        console.error('Error en RPC RAG:', error);
        return [];
    }

    return data;
}

/** Función de Handoff: Llama a la RPC `rpc_handoff_trigger` para crear el caso y activar n8n. */
async function triggerHandoff(conversationId: string): Promise<void> {
    const { error } = await supabase.rpc('rpc_handoff_trigger', {
        conversation_id_in: conversationId,
    });

    if (error) {
        console.error('Error triggering handoff RPC:', error);
        throw new Error('Handoff trigger failed.');
    }
}


/** Ejecuta el RAG, llama al LLM, y decide si sugerir un servicio o solo dar consejo. */
async function handleAdvisoryFlow(phoneNumber: string, message: string, conversationId: string) {
    // 1. Ejecutar RAG
    const ragResults = await matchLegalDocuments(message); 
    const ragContext = ragResults.map(r => r.content_chunk).join('\n---\n');
    const serviceOffered = ragResults.find(r => r.service_id)?.service_id; 
    
    // 2. Construcción del Prompt y LLAMADA REAL AL LLM
    const systemPrompt = `Eres el Agente Legal AVOCADO. Genera un "Concepto Previo" y sugiere un servicio si el contexto RAG lo permite.`;
    const fullPrompt = `${systemPrompt}\nContexto RAG: ${ragContext}\nConsulta: ${message}`;
    
    // Aquí se ejecutaría la llamada: const llmResponse = await openai.chat.completions.create(...);
    const aiResponseText = `*Concepto Previo:* Hemos analizado tu consulta. Se encontraron ${ragResults.length} documentos relevantes.`; // Placeholder
    const totalTokens = 500; // Placeholder

    // 3. TRAZABILIDAD CRÍTICA
    await logAIInteraction(
        conversationId,
        'gpt-4o-mini', // Modelo usado (ajustar)
        fullPrompt,
        aiResponseText,
        ragResults.map(r => r.id),
        totalTokens
    );

    // 4. Decisión de Servicio y Actualización de Estado
    if (serviceOffered) {
        aiResponseText += `\n\n*Servicio Recomendado:* Nuestro servicio de "${serviceOffered}" resuelve tu necesidad. ¿Deseas iniciar este proceso? (Escribe "iniciar servicio").`;
        // Actualizar estado a la fase de aceptación de servicio.
        await supabase.from('conversations').update({ current_state: 'service_agreed' }).eq('id', conversationId);
    } else {
        aiResponseText += `\n\n*Aviso:* Para un análisis más profundo, sugerimos contactar un abogado (Servicio Counsel).`;
    }
    
    // 5. Envío de la respuesta final.
    await sendWhatsappMessage(phoneNumber, aiResponseText);
}


// ----------------------------------------------------------------------
// --- 3. AGENTE ROUTER (MÁQUINA DE ESTADO) ---
// ----------------------------------------------------------------------

/** Función central: Determina el estado del usuario y enruta la solicitud del chat. */
async function handleChatMessage(phoneNumber: string, message: string) {
    // 1. Obtener/Crear Conversación: Buscar el estado actual ('current_state').
    let { data: conversation } = await supabase
        .from('conversations')
        .select(`id, user_id, current_state`)
        .eq('phone_number_unregistered', phoneNumber)
        .maybeSingle();

    if (!conversation) {
        // Usuario completamente nuevo: crear conversación con estado 'initial'.
        const { data: newConv } = await supabase
            .from('conversations')
            .insert({ phone_number_unregistered: phoneNumber, current_state: 'initial' })
            .select('*')
            .single();
        conversation = newConv;
    }

    const currentState = conversation.current_state;
    const conversationId = conversation.id;

    // 2. SWITCH DE ESTADO (Embudo de Autenticación/Servicio).
    switch (currentState) {
        
        case 'initial':
            // CRUCE DE AUTENTICACIÓN: Intentar resolver la identidad (Condición 1).
            const { data: profile } = await supabase
                .from('profiles')
                .select('id, full_name')
                .eq('phone_number', phoneNumber)
                .maybeSingle();
            
            if (profile) {
                // Cliente ACTIVO: Actualizar 'user_id' y pasar a asesoría IA.
                await supabase.from('conversations').update({ user_id: profile.id, current_state: 'advisory_ia' }).eq('id', conversationId);
                await sendWhatsappMessage(phoneNumber, `¡Bienvenido ${profile.full_name}! Tu cuenta está activa. ¿En qué te asisto?`);
            } else {
                // Nuevo usuario: Inicia el flujo de orientación IA.
                await handleAdvisoryFlow(phoneNumber, message, conversationId);
            }
            break;
            
        case 'pending_signup':
        case 'pending_signin':
            // MANEJO DEL EMBUDO (Condiciones 2, 3, 4: Requisito de cuenta).
            if (message.toLowerCase().includes('continuar')) {
                // Re-validar si la cuenta ya fue creada/logueada externamente.
                const { data: profileCheck } = await supabase.from('profiles').select('id').eq('phone_number', phoneNumber).maybeSingle();
                
                if (profileCheck) {
                    await supabase.from('conversations').update({ user_id: profileCheck.id, current_state: 'advisory_ia' }).eq('id', conversationId);
                    await sendWhatsappMessage(phoneNumber, '¡Cuenta verificada! Continuemos con tu consulta legal.');
                } else {
                    await sendWhatsappMessage(phoneNumber, 'Aún no encuentro tu cuenta. Por favor, completa el registro o escribe "ayuda".');
                }
            } else {
                // Recordatorio de la acción pendiente.
                await sendWhatsappMessage(phoneNumber, 'Por favor, usa el link de registro/login para continuar con tu servicio.');
            }
            break;
            
        case 'advisory_ia':
            // FLUJO PRINCIPAL: El usuario está en la fase de orientación legal.
            await handleAdvisoryFlow(phoneNumber, message, conversationId);
            break;

        case 'service_agreed':
            // ACEPTACIÓN DE SERVICIO: Si el usuario confirma la acción ("iniciar servicio" o "sí").
            if (message.toLowerCase().includes('iniciar servicio') || message.toLowerCase().includes('sí')) {
                await sendWhatsappMessage(phoneNumber, '¡Perfecto! Iniciando el proceso legal...');
                await triggerHandoff(conversationId); // Llama al RPC que activa n8n.
                await sendWhatsappMessage(phoneNumber, 'Proceso iniciado con éxito. Recibirás una notificación con los detalles del caso en breve.');
            } else {
                 await sendWhatsappMessage(phoneNumber, 'Escribe "iniciar servicio" para activar el proceso legal en la oficina virtual.');
            }
            break;
            
        case 'closed':
            // Conversación ya cerrada (caso en Notion/Google). Sugerir un nuevo caso.
            await sendWhatsappMessage(phoneNumber, 'Este caso ya ha sido cerrado. ¿Tienes una nueva consulta? Escribe algo para iniciar.');
            await supabase.from('conversations').update({ current_state: 'initial' }).eq('id', conversationId);
            break;
    }
}


// ----------------------------------------------------------------------
// --- 4. HANDLER HTTP PRINCIPAL (Punto de Entrada Deno) ---
// ----------------------------------------------------------------------

serve(async (req) => {
    // Manejo de GET: Lógica de verificación de Meta (hub.mode, hub.verify_token).
    if (req.method === 'GET') {
        const url = new URL(req.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (mode === "subscribe" && token === META_VERIFY_TOKEN && challenge) {
            return new Response(challenge, { status: 200 });
        } else {
            return new Response('Verification failed', { status: 403 });
        }
    }

    // Procesamiento de POST: Recepción de mensaje de WhatsApp.
    if (req.method === 'POST') {
        const body = await req.json();
        
        const messageObject = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        const senderId = messageObject?.from;
        const messageText = messageObject?.text?.body || messageObject?.button?.text; // Capturar texto o botón

        if (!senderId) {
             return new Response("No valid sender ID.", { status: 200 });
        }
        
        try {
            // Ejecución del Agente Router.
            await handleChatMessage(senderId, messageText || '');
        } catch (error) {
            console.error('Error fatal en Agente Router:', error.message);
        }
        
        // Respuesta CRÍTICA: Devolver 200 OK inmediatamente (Serverless Edge).
        return new Response(JSON.stringify({ status: "Message received and processed" }), { status: 200 });
    }
    
    return new Response('Method not allowed', { status: 405 });
});