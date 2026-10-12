import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { jwtDecode } from "jwt-decode";
import { MAGIC_LINK_PENDING_REDIRECT_KEY } from "@/lib/magicLink";
import { MULTIPLE_FUNNEL_PENDING_KEY } from "@/lib/multipleFunnels";
import { isAbtReminderPath } from "@/lib/publicRoutes";

interface TokenValidatorProps {
  children: React.ReactNode;
}

/**
 * TokenValidator Component
 * Validates JWT token on every route CHANGE (not on page refresh for login)
 * Redirects to /login if token is missing or invalid
 * Skips validation for /login route (public page)
 */
export function TokenValidator({ children }: TokenValidatorProps) {
  const [location, setLocation] = useLocation();
  const [previousLocation, setPreviousLocation] = useState<string | null>(null);

  // Helper function to validate JWT format and expiration
  const isValidJWT = (token: string): boolean => {
    try {
      const payload = jwtDecode(token);

      // Check if token has expiration and if it's expired
      if (payload.exp) {
        const expirationTime = payload.exp * 1000; // Convert to milliseconds
        if (Date.now() >= expirationTime) {
          return false; // Token is expired
        }
      }

      return true;
    } catch (error) {
      console.error("Invalid JWT format:", error);
      return false;
    }
  };

  // Validate token only on route CHANGE (not on page refresh for login)
  useEffect(() => {
    // Skip validation if:
    // 1. Current location is /login or /reset-password (public pages - no token validation)
    // 2. This is the first render (previousLocation is null)
    // 3. Current location is the public ABT appointment reminder (/abt-reminder/*)
    if (
      location === "/login" ||
      location === "/reset-password" ||
      isAbtReminderPath(location) ||
      previousLocation === null
    ) {
      setPreviousLocation(location);
      return;
    }

    // Only validate if we're changing routes (previousLocation !== location)
    if (previousLocation !== location) {
      const token = localStorage.getItem("ahcs_token");

      // If no token or invalid token, clear storage and redirect to login
      if (!token || !isValidJWT(token)) {
        console.warn("Token validation failed - redirecting to login");
        localStorage.clear();
        const formRedirectFlag = sessionStorage.getItem("ahcs_user_exists_form_redirect");
        const pendingMagicLinkRedirect = sessionStorage.getItem(MAGIC_LINK_PENDING_REDIRECT_KEY);
        const pendingMultipleFunnelRedirect = sessionStorage.getItem(MULTIPLE_FUNNEL_PENDING_KEY);
        sessionStorage.clear();
        if (formRedirectFlag) sessionStorage.setItem("ahcs_user_exists_form_redirect", formRedirectFlag);
        if (pendingMagicLinkRedirect) sessionStorage.setItem(MAGIC_LINK_PENDING_REDIRECT_KEY, pendingMagicLinkRedirect);
        if (pendingMultipleFunnelRedirect) sessionStorage.setItem(MULTIPLE_FUNNEL_PENDING_KEY, pendingMultipleFunnelRedirect);
        if (location === "/" || location === "/login") {
          setLocation("/login");
        } else {
          setLocation(`/login?redirect=${encodeURIComponent(location)}`);
        }
      }
    }

    setPreviousLocation(location);
  }, [location, setLocation, previousLocation]);

  return <>{children}</>;
}

export default TokenValidator;
