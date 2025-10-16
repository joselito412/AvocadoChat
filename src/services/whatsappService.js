import sendToWhatsApp from "../services/httpRequest/sendToWhatsApp.js";

class WhatsAppService {
  async sendMessage(to, body, messageId) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      text: { body },
    };

    try {
      await sendToWhatsApp(data);
    } catch (error) {
      console.error(`Error al enviar mensaje a ${to}: ${error.message}`, error);
      // Aquí se debe integrar tu servicio de monitoreo/logging
    }
  }

  async sendInteractiveButtons(to, bodyText, buttons) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons,
        },
      },
    };

    try {
      await sendToWhatsApp(data);
    } catch (error) {
      console.error(`Error al enviar botones interactivos a ${to}: ${error.message}`, error);
      // Aquí se debe integrar tu servicio de monitoreo/logging
    }
  }

  async sendMediaMessage(to, type, mediaUrl, caption) {
    const mediaObject = {};

    switch (type) {
      case 'image':
        mediaObject.image = { link: mediaUrl, caption: caption };
        break;
      case 'audio':
        mediaObject.audio = { link: mediaUrl };
        break;
      case 'video':
        mediaObject.video = { link: mediaUrl, caption: caption };
        break;
      case 'document':
        mediaObject.document = { link: mediaUrl, caption: caption, filename: '' };
        break;
      default:
        throw new Error('Not Supported Media Type');
    }

    const data = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: type,
      ...mediaObject,
    };

    try {
      await sendToWhatsApp(data);
    } catch (error) {
      console.error(`Error al enviar media (${type}) a ${to}: ${error.message}`, error);
      // Aquí se debe integrar tu servicio de monitoreo/logging
    }
  }

  async markAsRead(messageId) {
    const data = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };

    try {
      await sendToWhatsApp(data);
    } catch (error) {
      console.error(`Error al marcar mensaje ${messageId} como leído: ${error.message}`, error);
      // Aquí se debe integrar tu servicio de monitoreo/logging
    }
  }

  async sendContactMessage(to, contact) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'contacts',
      contacts: [contact],
    };

    try {
      await sendToWhatsApp(data);
    } catch (error) {
      console.error(`Error al enviar contacto a ${to}: ${error.message}`, error);
      // Aquí se debe integrar tu servicio de monitoreo/logging
    }
  }

  async sendLocationMessage(to, latitude, longitude, name, address) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'location',
      location: {
        latitude: latitude,
        longitude: longitude,
        name: name,
        address: address
      }
    };
    
    try {
      await sendToWhatsApp(data);
    } catch (error) {
      console.error(`Error al enviar ubicación a ${to}: ${error.message}`, error);
      // Aquí se debe integrar tu servicio de monitoreo/logging
    }
  }
}

export default new WhatsAppService();