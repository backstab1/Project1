// Единственное место, которое знает, как создаётся клиент Supabase.
//
// Сборщика в проекте нет, поэтому библиотека лежит собранным ESM-файлом в
// vendor/ — он появляется после `npm install && npm run vendor:supabase`.

import { SUPABASE_ANON_KEY, SUPABASE_URL, isServerConfigured } from "../config.js";

let clientPromise = null;

export class ServerNotConfiguredError extends Error {
  constructor() {
    super("Сервер CineVault не настроен: заполните SUPABASE_URL и SUPABASE_ANON_KEY.");
    this.name = "ServerNotConfiguredError";
  }
}

export function getSupabaseClient() {
  if (!isServerConfigured()) {
    return Promise.reject(new ServerNotConfiguredError());
  }

  if (!clientPromise) {
    clientPromise = import("../../vendor/supabase.esm.js")
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        }),
      )
      .catch((error) => {
        clientPromise = null;
        if (error instanceof ServerNotConfiguredError) throw error;
        throw new Error(
          "Не удалось загрузить библиотеку Supabase из vendor/. " +
            "Выполните npm install и npm run vendor:supabase.",
        );
      });
  }

  return clientPromise;
}
