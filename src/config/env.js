import dotenv from 'dotenv';

dotenv.config();

export default {
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  API_VERSION: process.env.API_VERSION,
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OPENAI_API_KEY: process.env.CHATGPT_API_KEY, // Se mapea CHATGPT_API_KEY a OPENAI_API_KEY
};