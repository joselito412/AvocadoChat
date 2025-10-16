import whatsappService from './whatsappService.js';
// import appendToSheet from './googleSheetsService.js';
import aiService from './aiService.js';

class MessageHandler {

  constructor() {
    // Estados para mantener el contexto del usuario en flujos secuenciales
    this.appointmentState = {}; 
    this.assistandState = {};
    this.loginState = {}; 
  }

  // =========================================================
  // === 1. EL ROUTER PRINCIPAL: EL FLUJO DE DECISIONES ===
  // =========================================================

  async handleIncomingMessage(userText, fromNumber, senderInfo) {
    
    const incomingMessage = userText.toLowerCase().trim();
    const to = fromNumber;
    
    // 1. PRIORIDAD MÁXIMA: RESPUESTA A BOTONES INTERACTIVOS (Ej: option_1, option_a)
    if (incomingMessage.startsWith('option_')) {
        await this.handleMenuOption(to, incomingMessage);
        return;
    } 
    
    // 2. DETECCIÓN DE SALUDO: Muestra el menú inicial
    if (this.isGreeting(incomingMessage)) {
        await this.sendWelcomeMessage(to, null, senderInfo); 
        await this.sendWelcomeMenu(to);
        return;
    }
    
    // 3. FLUJO DE LOGIN/REGISTRO ACTIVO: Esperando un dato (email, ID, nombre)
    if (this.loginState[to]) {
        await this.handleLoginOrRegistrationFlow(to, incomingMessage);
        return;
    } 
    
    // 4. FLUJO DE ASISTENTE IA ACTIVO: Conversación continua con la IA
    if (this.assistandState[to]) {
        await this.handleAiQuery(to, incomingMessage);
        return;
    }
    
    // 5. RESPALDO/DEFAULT: Todo lo demás va a la Inteligencia Artificial
    await this.handleAiQuery(to, incomingMessage);
  }

  // =========================================================
  // === 2. LÓGICA DE MANEJO DE OPCIONES DE MENÚS ===
  // =========================================================

  async handleMenuOption(to, optionId) {
    
    switch (optionId) {
      // --- OPCIONES GLOBALES DE NAVEGACIÓN ---
      case 'option_0': // Volver al menú principal desde cualquier submenú
      case 'option_4_back': // Si, Gracias (Finalizar y Volver)
        if (this.loginState[to]) delete this.loginState[to];
        if (this.assistandState[to]) delete this.assistandState[to];
        await this.sendWelcomeMenu(to);
        break;

      // --- OPCIONES DEL MENÚ PRINCIPAL ---
      case 'option_1': // Iniciar Sesión: Inicia el flujo de login
        this.loginState[to] = { step: 'waiting_for_credential', type: 'login' };
        await whatsappService.sendMessage(to, "Por favor, ingresa tu **Nº de identificación** o **Dirección E-mail** para iniciar sesión.");
        break;

      case 'option_2': // Registrarse: Inicia el flujo de registro
        this.loginState[to] = { step: 'waiting_for_name', type: 'register' };
        await whatsappService.sendMessage(to, "¡Excelente! Empecemos tu registro. Por favor, ¿Cuál es tu nombre completo?");
        break;

      case 'option_3': // Quiero información: Muestra el submenú de información
        await this.sendInformationSubMenu(to);
        break;

      // --- OPCIONES DEL SUB-MENÚ DE INFORMACIÓN (Consolidado) ---
      case 'option_a_c': // A. Info General y Social (Consolidado de A y C)
        // Enviar enlace de servicios generales (A)
        await this.sendLink(to, 
            'https://avocado.center/services/', 
            'Aquí puedes ver información general y sobre nuestro impacto LegalTech:'
        );
        break;
        
      case 'option_b': // B. Planes y Tarifas -> Notion Link
        await this.sendLink(to, 
            'https://ambitious-bongo-b6d.notion.site/Catalogo-de-servicios-de-AVOCADO-center-1d5299b51c848177893afb21fb25e58a', 
            'Consulta el detalle de Planes y Tarifas aquí:'
        );
        break;
        
      // --- OPCIONES DE SEGUIMIENTO DE LA IA ---
      case 'option_5': // Hacer otra consulta (Mantiene el flujo de IA activo)
        this.assistandState[to] = true;
        await whatsappService.sendMessage(to, "¿Cuál es tu próxima pregunta?");
        break;

      case 'option_6': // Emergencia
        delete this.assistandState[to];
        await whatsappService.sendMessage(to, "Hemos notificado al equipo de emergencia. En breve un profesional te contactará.");
        break;
        
      default:
        // Si se recibe un ID no reconocido, vuelve a enviar el menú principal
        await whatsappService.sendMessage(to, "Opción no reconocida. Volviendo al menú principal.");
        await this.sendWelcomeMenu(to);
        break;
    }
  }

  // Lógica para manejar la secuencia de login/registro paso a paso
  async handleLoginOrRegistrationFlow(to, message) {
    const state = this.loginState[to];
    let response = "";

    if (state.type === 'login' && state.step === 'waiting_for_credential') {
        // Simulación de éxito de login
        delete this.loginState[to]; 
        response = `¡Bienvenido de nuevo! Hemos verificado tus datos. ¿En qué te puedo ayudar hoy?`;
        
    } else if (state.type === 'register' && state.step === 'waiting_for_name') {
        state.name = message;
        state.step = 'waiting_for_email';
        response = "Gracias, ahora, ¿Cuál es tu **correo electrónico**?";
        
    } else if (state.type === 'register' && state.step === 'waiting_for_email') {
        state.email = message;
        state.step = 'waiting_for_id';
        response = `Por último, ingresa tu **Nº de identificación** para completar el registro.`;

    } else if (state.type === 'register' && state.step === 'waiting_for_id') {
        state.id = message;
        // Simulación de registro completado
        delete this.loginState[to]; 
        response = `¡Gracias por registrarte, ${state.name}! Hemos creado tu cuenta. ¿En qué te puedo ayudar hoy?`;
    } 
    
    await whatsappService.sendMessage(to, response);

    // Finaliza el flujo de login/registro enviando el menú de seguimiento de IA
    if (!this.loginState[to]) {
        await this.sendAiFollowUpMenu(to);
    }
  }


  // =========================================================
  // === 3. FUNCIONES DE MENÚS Y ASISTENTE IA ===
  // =========================================================

  async handleAiQuery(to, message) {
    const aiResponse = await aiService(message);
    
    await whatsappService.sendMessage(to, aiResponse);
    await this.sendAiFollowUpMenu(to);
  }
  
  // Envía los botones de seguimiento después de una respuesta de IA (3 botones: Finalizar, Otra consulta, Volver)
  async sendAiFollowUpMenu(to) {
      const menuMessage = "¿La respuesta fue de tu ayuda?"
      const buttons = [
        // Opción 1: Finalizar (y por lógica, volver al menú principal)
        { type: 'reply', reply: { id: 'option_4_back', title: "Si, Gracias (Finalizar)" } }, 
        // Opción 2: Continuar la conversación
        { type: 'reply', reply: { id: 'option_5', title: 'Hacer otra consulta'}},
        // Opción 3: Volver al menú principal (Opción más solicitada)
        { type: 'reply', reply: { id: 'option_0', title: '⬅️ Menú Principal'}}
      ];
      await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  // Envía el submenú de información (A+C, B, Volver)
  async sendInformationSubMenu(to) {
    const menuMessage = "¿Qué deseas saber sobre nuestros servicios LegalTech?"
    const buttons = [
      { type: 'reply', reply: { id: 'option_a_c', title: 'A. Info General' } }, // Consolidado (Máx 20 chars)
      { type: 'reply', reply: { id: 'option_b', title: 'B. Planes y Tarifas' } }, // Máx 20 chars
      { type: 'reply', reply: { id: 'option_0', title: '⬅️ Menú Principal'}}
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }
  
  // FUNCIÓN GENÉRICA para enviar enlaces y asegurar el link preview
  async sendLink(to, url, caption) {
    // La URL en una línea separada asegura la previsualización en WhatsApp
    const message = `${caption}\n\n${url}`;
    
    await whatsappService.sendMessage(to, message); 
    
    // Ofrece las opciones de seguimiento después de enviar el enlace
    await this.sendAiFollowUpMenu(to); 
  }


  // =========================================================
  // === 4. FUNCIONES DE UTILIDAD Y BIENVENIDA ===
  // =========================================================

  isGreeting(message) {
    const greetings = ["hola", "hello", "hi", "buenas tardes", "buenos días", "buenas noches", "qué onda", "qué tal", "qué haces", "¿cómo va?", "¿qué me cuentas?", "hey", "saludos", "hola, ¿todo bien?", "holi", "¿cómo andas?", "¿qué hay de nuevo?", "¡qué gusto saludarte!", "te escribo para"];
    return greetings.includes(message);
  }

  getSenderName(senderInfo) {
    const fullName = senderInfo?.profile?.name || senderInfo?.wa_id || 'Nuevo usuario';
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || fullName; 
    return firstName;
  }

  // Mensaje de bienvenida inicial
  async sendWelcomeMessage(to, messageId, senderInfo) {
    const name = this.getSenderName(senderInfo);
    const welcomeMessage = `Hola ${name}\n¡Bienvenido a AVOCADO, tu solución legal de bolsillo!\n \nPara atender tu consulta y proteger tu información, debes iniciar sesión.\n \nPara continuar, por favor selecciona una opción:`;
    await whatsappService.sendMessage(to, welcomeMessage, messageId);
  }

  // Menú principal (Login/Registro/Información)
  async sendWelcomeMenu(to) {
    const menuMessage = "¿Ya tienes cuenta AVOCADO?"
    const buttons = [
      { type: 'reply', reply: { id: 'option_1', title: 'Iniciar sesión'} },
      { type: 'reply', reply: { id: 'option_2', title: 'No tengo cuenta'} },
      { type: 'reply', reply: { id: 'option_3', title: 'Quiero información'} }
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }
}

export default new MessageHandler();