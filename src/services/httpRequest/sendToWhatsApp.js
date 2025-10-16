import config from '../../config/env.js';
import fetch from 'node-fetch'; // Asumiendo que usas node-fetch para las llamadas HTTP

// Construye la URL base para el envío de mensajes
const WHATSAPP_API_URL = 
  `https://graph.facebook.com/${config.API_VERSION}/${config.PHONE_NUMBER_ID}/messages`;

const sendToWhatsApp = async (data) => {
    try {
        console.log(`[META] Attempting to send message to: ${data.to}`);

        const response = await fetch(WHATSAPP_API_URL, {
            method: 'POST',
            headers: {
                // ESTO ES LO CRÍTICO: El token debe ir en el Header de Authorization
                'Authorization': `Bearer ${config.META_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            // Manejo de error de respuesta de Meta (400, 401, 500)
            const errorBody = await response.json();
            
            // ¡ESTE LOG TE DIRÁ SI EL TOKEN O EL ID ESTÁN MAL!
            console.error('[META API ERROR] Fallo en el envío. Detalles:', errorBody);
            
            // Revisa el estado 401 Unauthorized o 400 Bad Request
            throw new Error(`Meta API returned status ${response.status}: ${JSON.stringify(errorBody)}`);
        }

        console.log('[META API] Mensaje enviado exitosamente.');
        return response.json();

    } catch (error) {
        // Fallo de conexión o red
        console.error('[NETWORK ERROR] Error de red o conexión al intentar enviar a Meta:', error.message);
        throw error;
    }
};

export default sendToWhatsApp;