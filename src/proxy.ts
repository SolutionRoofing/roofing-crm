import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/env';

// /e/<token> (estimate/invoice), /p/<token> (photos) and /u/<token> (unsubscribe) are customer links: no login, the
// token is checked in the database. /api routes check their own secrets or tokens.
const PUBLIC_PATHS = ['/login', '/auth', '/setup', '/e', '/p', '/u', '/api'];

// Keeps the Supabase session cookie fresh and sends signed-out visitors to the login page.
// This is only a convenience redirect: every page and action checks the user again,
// and the database enforces permissions on its own.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));

  if (!isSupabaseConfigured()) {
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL('/setup', request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !isPublic) {
    const login = new URL('/login', request.url);
    if (pathname !== '/') login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)'],
};
