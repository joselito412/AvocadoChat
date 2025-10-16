import { GoogleGenAI } from '@google/genai';
import OpenAI from "openai";
import config from "../config/env.js";

const SYSTEM_INSTRUCTIONS = 
    'Eres parte de un servicio de asistencia online y debes de comportarte como un veterinario de un comercio llamado "MedPet". Resuelve las preguntas lo más simple posible, con una explicación posible. Si es una emergencia o debe de llamarnos (MedPet). Debes de responde en texto simple como si fuera un mensaje de un bot conversacional, no saludes, no generas conversación, solo respondes con la pregunta del usuario.';

const GEMINI_MODEL = 'gemini-2.5-flash';
const OPENAI_MODEL = 'gpt-4o'; 

const getGeminiClient = () => {
    if (!config.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY no está configurado.");
    }
    return new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
};

const getOpenAIClient = () => {
    if (!config.OPENAI_API_KEY) {
        return null;
    }
    return new OpenAI({ apiKey: config.OPENAI_API_KEY });
};

const aiService = async (message) => {
    
    try {
        const geminiClient = getGeminiClient(); // Inicialización diferida (Lazy)
        
        console.log(`[AI Service] Attempting primary model: ${GEMINI_MODEL}`);
        
        const response = await geminiClient.models.generateContent({
            model: GEMINI_MODEL,
            contents: [{ role: 'user', parts: [{ text: message }] }],
            config: {
                systemInstruction: SYSTEM_INSTRUCTIONS,
            }
        });
        
        const text = response.text;
        
        if (!text) {
            throw new Error('Gemini returned no text content.');
        }

        console.log('[AI Service] SUCCESS with Gemini.');
        return text;

    } catch (geminiError) {
        
        const openAiClient = getOpenAIClient();
        
        if (openAiClient) {
            console.warn(`[AI Service] Gemini failed. Trying configured fallback model: ${OPENAI_MODEL}.`);
            
            try {
                const response = await openAiClient.chat.completions.create({
                    messages: [
                        { role: 'system', content: SYSTEM_INSTRUCTIONS }, 
                        { role: 'user', content: message }
                    ],
                    model: OPENAI_MODEL
                });
                
                const text = response.choices[0].message.content;
                
                if (!text) {
                    throw new Error('OpenAI returned no text content.');
                }
                
                console.log('[AI Service] SUCCESS with OpenAI (Fallback).');
                return text;

            } catch (openaiError) {
                console.error('[AI Service] TOTAL FAILURE. Both models failed.');
                throw new Error('AI Service Error: Both primary and fallback models are unavailable.');
            }
        }
        
        console.error('[AI Service] PRIMARY MODEL FAILED. Fallback is disabled.');
        throw geminiError; 
    }
}

export default aiService;