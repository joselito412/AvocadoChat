import config from '../config/env.js';
import messageHandler from '../services/messageHandler.js';

class WebhookController {
  async handleIncoming(req, res) {
    // 1. Responder 200 OK inmediatamente a Meta
    res.sendStatus(200); 

    console.log('--- Webhook POST Received ---');
    
    try {
        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        const messageObject = value?.messages?.[0];
        const senderInfo = value?.contacts?.[0];
        const fromNumber = messageObject?.from;

        let userText = null;

        if (messageObject) {
            
            // 2. Extraer el contenido del mensaje (Maneja 3 Tipos)
            if (messageObject.type === 'text') {
                // Caso 1: Mensaje de texto plano (Ej: "Hola")
                userText = messageObject.text.body;
            } else if (messageObject.type === 'button') {
                // Caso 2: Respuesta a un botón de respuesta rápida (quick-reply)
                userText = messageObject.button.payload; // El payload es el ID del botón
            } else if (messageObject.type === 'interactive') {
                // Caso 3: Respuesta a un menú de botones interactivos
                userText = messageObject.interactive.button_reply.id; // El ID que definimos (option_1, option_A)
            }
        }
    
        // 3. Procesar el mensaje
        if (userText && fromNumber) {
          console.log(`[Webhook] Message received from ${fromNumber}: "${userText}"`);
          
          // Pasar el texto/ID extraído al MessageHandler
          await messageHandler.handleIncomingMessage(userText, fromNumber, senderInfo);
        } else {
            // Este log es útil para depurar mensajes de estado (read, delivered) que no son mensajes de usuario
            console.log("[Webhook] Received non-user message or content not supported.");
        }
    } catch (error) {
        console.error("Error durante el procesamiento del mensaje:", error);
    }
  }

  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      console.log('Webhook verified successfully!');
    } else {
      res.sendStatus(403);
    }
  }
}

export default new WebhookController();