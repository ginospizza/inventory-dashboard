import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Skip if Supabase is not configured (demo mode)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  try {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const pathname = request.nextUrl.pathname;

    // Public routes that don't need auth
    const isPublicRoute = pathname === "/" || pathname === "/login" || pathname.startsWith("/api/auth");

    if (!user && !isPublicRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    // If logged in and hitting /login, redirect to overview
    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/overview";
      return NextResponse.redirect(url);
    }

    // Admin-only route protection
    const adminOnlyPaths = ["/upload", "/admin"];
    if (user && adminOnlyPaths.some((p) => pathname.startsWith(p))) {
      const role = user.user_metadata?.role;
      if (role === "dsm") {
        const url = request.nextUrl.clone();
        url.pathname = "/overview";
        return NextResponse.redirect(url);
      }
    }

    return supabaseResponse;
  } catch {
    // If middleware fails, let the request through
    // Auth is enforced at the page level by getCurrentUser()
    return NextResponse.next({ request });
  }
}
