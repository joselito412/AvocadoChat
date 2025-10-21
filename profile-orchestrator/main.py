import base64
import json
import os
import logging
# Mantenemos las importaciones necesarias
from supabase import create_client, Client
from google import genai
from google.genai.errors import APIError as GeminiAPIError
from openai import OpenAI
from openai import APIError as OpenAIApiError

logging.basicConfig(level=logging.INFO)

# ----------------------------------------------------
# AHORA LAS VARIABLES DE ENTORNO SON LEÍDAS AQUÍ
SUPABASE_URL = os.environ.get("https://adivrswbqfkducogxosb.supabase.co")
SUPABASE_KEY = os.environ.get("sb_secret_RibBJCoGA2s-F5hV3gsX7Q_7oW8njuZ")
OPENAI_API_KEY = os.environ.get("") 
# Los modelos son constantes
GEMINI_EMBEDDING_MODEL = "text-embedding-004" 
OPENAI_EMBEDDING_MODEL = "text-embedding-ada-002"

# Eliminamos las inicializaciones globales. ¡Los clientes se inicializan en la función!
# ----------------------------------------------------

# La lógica de generación de embeddings debe moverse a dentro de la función principal
# para que pueda inicializar los clientes de manera local.

def generate_embedding(gemini_client, openai_client, text_input: str) -> tuple[list[float], str]:
    """Intenta generar un vector usando Gemini y recurre a OpenAI si falla."""
    
    # 1. INTENTO PRINCIPAL: GEMINI
    if gemini_client:
        try:
            logging.info("Intentando vectorización con Gemini (Principal)...")
            response = gemini_client.models.embed_content(
                model=GEMINI_EMBEDDING_MODEL,
                content=text_input,
                task_type="RETRIEVAL_DOCUMENT",
            )
            logging.info(f"Vectorización exitosa con {GEMINI_EMBEDDING_MODEL}.")
            return response['embedding'], GEMINI_EMBEDDING_MODEL
        except (GeminiAPIError, Exception) as e:
            logging.warning(f"FALLO de Gemini: {e.__class__.__name__}. Recurriendo a OpenAI.")

    # 2. INTENTO DE RESPALDO (FALLBACK): OPENAI
    if openai_client:
        try:
            logging.info("Intentando vectorización con OpenAI (Respaldo)...")
            response = openai_client.embeddings.create(
                model=OPENAI_EMBEDDING_MODEL,
                input=text_input,
            )
            vector = response.data[0].embedding
            logging.info(f"Vectorización exitosa con {OPENAI_EMBEDDING_MODEL} (FALLBACK).")
            return vector, OPENAI_EMBEDDING_MODEL
        except (OpenAIApiError, Exception) as e:
            logging.error(f"FALLO de OpenAI: {e.__class__.__name__}. No se pudo generar el vector.")
            raise Exception("Fallo en todas las opciones de vectorización.")
    
    raise Exception("Clientes de IA no inicializados o fallaron. Verifica las claves API.")


def profile_enrichment_orchestrator(event, context):
    """
    Función de Cloud Function: Vectoriza el perfil con IA y lo guarda en Supabase.
    """
    
    # -----------------------------------------------------------------
    # INICIALIZACIÓN LOCAL DENTRO DE LA FUNCIÓN (SOLUCIÓN AL HEALTHCHECK)
    # -----------------------------------------------------------------
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        gemini_client = genai.Client()
        openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
    except Exception as e:
        logging.error(f"FALLO DE INICIALIZACIÓN CRÍTICO EN TIEMPO DE EJECUCIÓN: {str(e)}")
        # Ya que el error ocurre en runtime, Pub/Sub lo reintentará.
        raise

    user_id = "unknown"
    model_used = "none"
    try:
        # 1. Decodificar y validar el mensaje de Pub/Sub
        pubsub_message = base64.b64decode(event['data']).decode('utf-8')
        user_data = json.loads(pubsub_message)
        user_id = user_data.get('whatsappId', 'unknown')
        
        logging.info(json.dumps({"event": "orchestrator_start", "user_id": user_id, "message": "Orquestador iniciado."}))
        
        # 2. Generar el vector con lógica de respaldo
        profile_string = f"Perfil de usuario de WhatsApp ID {user_id}. Datos: {json.dumps(user_data)}" 
        # Pasamos los clientes inicializados localmente a la función de embeddings
        vector, model_used = generate_embedding(gemini_client, openai_client, profile_string) 
        
        # 3. Insertar el perfil y el vector en Supabase
        insert_data = {
    # Campos obligatorios de la tabla 'users'
    "email": user_data.get('email', f"{user_id}@temp.com"), # Debe ser UNIQUE, usa un placeholder si falta
    "phone": user_data.get('phone', 'N/A'), # Debe ser NOT NULL
    "full_name": user_data.get('name', 'Usuario Chatbot'), 
    "role": user_data.get('role', 'client'), # Debe ser 'client' o 'lawyer'

    # El vector de la IA
    "embedding": vector 
}
        
        response = supabase.table('user_profiles').insert(insert_data).execute()
        
        # 4. Monitoreo: Verificar la inserción de Supabase
        if not response.data or len(response.data) == 0:
            raise Exception("Fallo al insertar datos en Supabase.")
        
        logging.info(json.dumps({"event": "orchestrator_success", "user_id": user_id, "model_used": model_used, "message": "Procesamiento y guardado exitoso."}))

        return "Procesamiento y guardado exitoso."

    except Exception as e:
        logging.error(json.dumps({"event": "orchestrator_error", "user_id": user_id, "model_used": model_used, "error_type": e.__class__.__name__, "error_message": str(e)}))
        raise # Fuerza el reintento de Pub/Sub