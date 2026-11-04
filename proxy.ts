import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Guest chat is public — no login needed
  if (pathname.startsWith("/chat/guest")) return NextResponse.next();

  // All other /chat routes require authentication
  if (pathname.startsWith("/chat") && !req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/chat/:path*"],
};
