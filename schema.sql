-- ============================================================
-- SCRIPT DE ESQUEMA PARA SUPABASE (RukaTv / Stremio Web)
-- Copia y ejecuta este script en el SQL Editor de tu panel Supabase
-- ============================================================

-- 1. Tabla para la Biblioteca, Continuar Viendo y Calendario
CREATE TABLE IF NOT EXISTS public.user_library (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT,
    poster TEXT,
    poster_shape TEXT,
    state JSONB DEFAULT '{}'::jsonb,
    mtime TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Row Level Security (RLS) para aislamiento por usuario
ALTER TABLE public.user_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own library" ON public.user_library;
CREATE POLICY "Users manage own library"
ON public.user_library FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2. Tabla para la Configuración y Addons / Fuentes Xtream personales
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{}'::jsonb,
    addons JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Row Level Security (RLS) para aislamiento por usuario
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings"
ON public.user_settings FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
