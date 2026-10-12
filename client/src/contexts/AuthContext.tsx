import React, { createContext, useContext, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { jwtDecode } from "jwt-decode";
import Apis from "@/lib/Apis";
import { getApiErrorMessage } from "@/lib/apiError";
import { consumePendingMagicLinkRedirect, MAGIC_LINK_PENDING_REDIRECT_KEY, getFormPath, URL_CASE_ID_KEY } from "@/lib/magicLink";
import { patientIdMatchesToken } from "@/lib/caseContext";
import { isEncodedEmailLink } from "@/lib/decodeEmailLink";
import { isAbtReminderPath } from "@/lib/publicRoutes";
import {
  readMultipleFunnelPendingRedirect,
  clearMultipleFunnelPendingRedirect,
  requestOpenMultipleFunnelsModal,
  MULTIPLE_FUNNEL_PENDING_KEY,
} from "@/lib/multipleFunnels";

export type UserRole = "patient" | "staff" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

export interface UserData {
  id: string | number;
  name: string;
  email: string;
  phone: string;
  role: string;
  patient_id: string | number;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => void;
  logout: () => Promise<void>;
  refreshUserDetails: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

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

  // Helper function to extract user data from JWT token
  const extractUserFromToken = (token: string, email: string): User | null => {
    try {
      const payload = jwtDecode<Record<string, any>>(token);
      
      // Determine role from token payload
      let role: UserRole = "patient";
      if (payload.role) {
        role = payload.role as UserRole;
      }

      const user: User = {
        id: (payload.id || payload.sub || "1") as string,
        name: (payload.name || email) as string,
        email: (payload.email || email) as string,
        role,
        avatar: (payload.avatar as string) || undefined,
      };

      return user;
    } catch (error) {
      console.error("Error extracting user from token:", error);
      return null;
    }
  };

  // Helper function to extract complete user data from JWT token
  const extractUserDataFromToken = (token: string): UserData | null => {
    try {
      const payload = jwtDecode<Record<string, any>>(token);
      
      const userData: UserData = {
        id: payload.id || payload.sub || "1",
        name: (payload.name || "") as string,
        email: (payload.email || "") as string,
        phone: (payload.phone || "") as string,
        role: (payload.role || "User") as string,
        patient_id: (payload.patient_id ?? payload.patientId ?? "") as string | number,
      };

      return userData;
    } catch (error) {
      console.error("Error extracting user data from token:", error);
      return null;
    }
  };

  // Check for existing session on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedToken = localStorage.getItem("ahcs_token");

        // Only restore session if token exists and is valid
        if (storedToken && isValidJWT(storedToken)) {
          // Extract user from token
          const user = extractUserFromToken(storedToken, "");
          if (user) {
            setUser(user);
          }
        } else if (storedToken && !isValidJWT(storedToken)) {
          // Token is invalid or expired, clear storage and redirect to login
          console.warn("Token is invalid or expired");
          localStorage.clear();
          const formRedirectFlag1 = sessionStorage.getItem("ahcs_user_exists_form_redirect");
          const pendingMagicLinkRedirect1 = sessionStorage.getItem(MAGIC_LINK_PENDING_REDIRECT_KEY);
          const pendingMultipleFunnel1 = sessionStorage.getItem(MULTIPLE_FUNNEL_PENDING_KEY);
          sessionStorage.clear();
          if (formRedirectFlag1) sessionStorage.setItem("ahcs_user_exists_form_redirect", formRedirectFlag1);
          if (pendingMagicLinkRedirect1) sessionStorage.setItem(MAGIC_LINK_PENDING_REDIRECT_KEY, pendingMagicLinkRedirect1);
          if (pendingMultipleFunnel1) sessionStorage.setItem(MULTIPLE_FUNNEL_PENDING_KEY, pendingMultipleFunnel1);
          // When the URL is an encoded magic link, let EmailLinkHandler decide the
          // destination (e.g. /reset-password for a new user). Redirecting to
          // /login here would clobber that routing for a stale/expired session.
          // The public ABT appointment reminder must stay reachable without a session.
          if (!isEncodedEmailLink(window.location.search) && !isAbtReminderPath(window.location.pathname)) {
            // Preserve any existing redirect param
            const existingRedirect = new URLSearchParams(window.location.search).get("redirect");
            setLocation(existingRedirect ? `/login?redirect=${encodeURIComponent(existingRedirect)}` : "/login");
          }
        } else if (!storedToken) {
          // No token found, user is not authenticated
          // Don't clear storage here - just set loading to false
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
        // Clear storage only on actual error
        localStorage.clear();
        const formRedirectFlag2 = sessionStorage.getItem("ahcs_user_exists_form_redirect");
        const pendingMagicLinkRedirect2 = sessionStorage.getItem(MAGIC_LINK_PENDING_REDIRECT_KEY);
        const pendingMultipleFunnel2 = sessionStorage.getItem(MULTIPLE_FUNNEL_PENDING_KEY);
        sessionStorage.clear();
        if (formRedirectFlag2) sessionStorage.setItem("ahcs_user_exists_form_redirect", formRedirectFlag2);
        if (pendingMagicLinkRedirect2) sessionStorage.setItem(MAGIC_LINK_PENDING_REDIRECT_KEY, pendingMagicLinkRedirect2);
        if (pendingMultipleFunnel2) sessionStorage.setItem(MULTIPLE_FUNNEL_PENDING_KEY, pendingMultipleFunnel2);
      } finally {
        setIsLoading(false);
      }
    };
    
    initializeAuth();
  }, [setLocation]);

  const login = async (email: string, password: string) => {
    try {
      const formData = new FormData();
      formData.append("email", email);
      formData.append("password", password);

      const data = await Apis.login(formData);

      if (data.success === false) {
        toast({
          title: "Login Failed",
          description: data.message || data.error || "",
          variant: "destructive",
        });
        return;
      }

      if (data.success === true && data.token) {
        // Store token in localStorage
        localStorage.setItem("ahcs_token", data.token);

        // Extract user information from token using jwt-decode
        const user = extractUserFromToken(data.token, email);
        const userData = extractUserDataFromToken(data.token);
        
        if (user) {
          setUser(user);
          
          // Store complete user data from token
          if (userData) {
            localStorage.setItem("ahcs_user_data", JSON.stringify(userData));
          }

          // Highest priority: a pending multiple-funnel continuation. Keep the
          // record in place for the app-level modal, pre-sync the case so its
          // first fetch is correctly scoped, and land on the dashboard. Clear
          // the competing single-funnel redirect keys so only the modal drives
          // navigation. Runs BEFORE the single-funnel redirect ladder below.
          const multipleFunnelPending = readMultipleFunnelPendingRedirect();
          if (multipleFunnelPending) {
            if (!patientIdMatchesToken(multipleFunnelPending.patient_id)) {
              clearMultipleFunnelPendingRedirect();
              toast({
                title: "Wrong Account",
                description: "This link belongs to a different patient account. Please logout and then try the link again.",
                variant: "destructive",
              });
              setLocation("/");
              return;
            }
            sessionStorage.removeItem(MAGIC_LINK_PENDING_REDIRECT_KEY);
            sessionStorage.removeItem("ahcs_user_exists_form_redirect");
            sessionStorage.removeItem("ahcs_sms_no_user_form_redirect");
            sessionStorage.removeItem("ahcs_password_reset_flow");
            sessionStorage.removeItem(URL_CASE_ID_KEY);
            if (multipleFunnelPending.case_id) {
              localStorage.setItem("ahcs_selected_case_id", multipleFunnelPending.case_id);
              refreshUserDetails().catch(() => {});
            }
            requestOpenMultipleFunnelsModal();
            setLocation("/");
            return;
          }

          // Consume the URL case_id written by EmailLinkHandler before any
          // verify/redirect calls. Used as a last-resort fallback below if
          // the primary pending-redirect mechanism doesn't carry a caseId.
          const urlCaseId = sessionStorage.getItem(URL_CASE_ID_KEY) || "";
          sessionStorage.removeItem(URL_CASE_ID_KEY);
          const pendingMagicLinkRedirect = consumePendingMagicLinkRedirect();
          if (pendingMagicLinkRedirect?.path) {
            sessionStorage.removeItem("ahcs_user_exists_form_redirect");
            if (!patientIdMatchesToken(pendingMagicLinkRedirect.patientId)) {
              toast({
                title: "Wrong Account",
                description: "This link belongs to a different patient account. Please logout and then try the link again.",
                variant: "destructive",
              });
              setLocation("/");
              return;
            }
            // Use the pending redirect's caseId, or fall back to the URL case_id
            // that was captured by EmailLinkHandler before the verify call.
            const caseIdToApply = pendingMagicLinkRedirect.caseId || urlCaseId;
            if (caseIdToApply) {
              // Select the case from the magic link locally (scoped via the
              // ?case_id query param). Avoid change-patient-case here so a token
              // rotation can't 401 and force a logout right after login.
              localStorage.setItem("ahcs_selected_case_id", caseIdToApply);
              // Explicitly fetch patient details for this case right now so
              // getPatientDetails fires with case_id=caseIdToApply before any
              // component mounts and makes its own call. Non-blocking so the
              // navigation below is not delayed.
              refreshUserDetails().catch(() => {});
            }
            setLocation(pendingMagicLinkRedirect.path);
          } else {
            // Check if login is from "user_exists" email-link flow
            const userExistsFormRedirect = sessionStorage.getItem("ahcs_user_exists_form_redirect");
            if (userExistsFormRedirect) {
              sessionStorage.removeItem("ahcs_user_exists_form_redirect");
              try {
                const parsed = JSON.parse(userExistsFormRedirect);
                // Switch to the case from the funnel link before navigating so
                // the form loads with the correct case context.
                const targetCaseId = String(parsed?.case_id || urlCaseId || "").trim();
                if (targetCaseId) {
                  localStorage.setItem("ahcs_selected_case_id", targetCaseId);
                  refreshUserDetails().catch(() => {});
                }
                const redirectPath = getFormPath(parsed?.form ?? null);
                setLocation(redirectPath ?? "/");
              } catch {
                // Fallback: if not JSON, use raw value (backward compat)
                const redirectPath = getFormPath(userExistsFormRedirect);
                setLocation(redirectPath ?? "/");
              }
              return;
            }

            // Check if login is from sms no_user flow after password setup
            const smsNoUserFormRedirect = sessionStorage.getItem("ahcs_sms_no_user_form_redirect");
            if (smsNoUserFormRedirect) {
              sessionStorage.removeItem("ahcs_sms_no_user_form_redirect");
              sessionStorage.removeItem("ahcs_password_reset_flow");
              const redirectPath = getFormPath(smsNoUserFormRedirect);
              setLocation(redirectPath ?? "/");
              return;
            }

            // Check if login is from password reset flow
            const isPasswordResetFlow = sessionStorage.getItem("ahcs_password_reset_flow");
            if (isPasswordResetFlow) {
              // Clear the flag and redirect to patient dashboard
              sessionStorage.removeItem("ahcs_password_reset_flow");
              setLocation("/");
            } else {
              // Redirect to original page if redirect param exists, otherwise based on role
              const params = new URLSearchParams(window.location.search);
              const redirectTo = params.get("redirect");
              if (redirectTo) {
                setLocation(decodeURIComponent(redirectTo));
              } else if (user.role === "admin") {
                setLocation("/admin");
              } else if (user.role === "staff") {
                setLocation("/staff");
              } else {
                setLocation("/");
              }
            }
          }
        } else {
          // If token decode fails, still redirect to patient dashboard
          const fallbackUser: User = {
            id: "1",
            name: email,
            email,
            role: "patient",
          };
          setUser(fallbackUser);

          // Highest priority: pending multiple-funnel continuation (mirrors the
          // primary branch above). Keep the record for the modal, pre-sync case,
          // clear competing single-funnel keys, land on the dashboard.
          const fallbackMultipleFunnelPending = readMultipleFunnelPendingRedirect();
          if (fallbackMultipleFunnelPending) {
            if (!patientIdMatchesToken(fallbackMultipleFunnelPending.patient_id)) {
              clearMultipleFunnelPendingRedirect();
              toast({
                title: "Wrong Account",
                description: "This link belongs to a different patient account. Please logout and then try the link again.",
                variant: "destructive",
              });
              setLocation("/");
              return;
            }
            sessionStorage.removeItem(MAGIC_LINK_PENDING_REDIRECT_KEY);
            sessionStorage.removeItem("ahcs_user_exists_form_redirect");
            sessionStorage.removeItem("ahcs_sms_no_user_form_redirect");
            sessionStorage.removeItem("ahcs_password_reset_flow");
            sessionStorage.removeItem(URL_CASE_ID_KEY);
            if (fallbackMultipleFunnelPending.case_id) {
              localStorage.setItem("ahcs_selected_case_id", fallbackMultipleFunnelPending.case_id);
              refreshUserDetails().catch(() => {});
            }
            requestOpenMultipleFunnelsModal();
            setLocation("/");
            return;
          }

          // Same URL case_id fallback as the primary branch above.
          const fallbackUrlCaseId = sessionStorage.getItem(URL_CASE_ID_KEY) || "";
          sessionStorage.removeItem(URL_CASE_ID_KEY);
          const fallbackPendingMagicLinkRedirect = consumePendingMagicLinkRedirect();
          if (fallbackPendingMagicLinkRedirect?.path) {
            sessionStorage.removeItem("ahcs_user_exists_form_redirect");
            if (!patientIdMatchesToken(fallbackPendingMagicLinkRedirect.patientId)) {
              toast({
                title: "Wrong Account",
                description: "This link belongs to a different patient account.",
                variant: "destructive",
              });
              setLocation("/");
              return;
            }
            const fallbackCaseIdToApply = fallbackPendingMagicLinkRedirect.caseId || fallbackUrlCaseId;
            if (fallbackCaseIdToApply) {
              localStorage.setItem("ahcs_selected_case_id", fallbackCaseIdToApply);
              refreshUserDetails().catch(() => {});
            }
            setLocation(fallbackPendingMagicLinkRedirect.path);
          } else {
            // Check if login is from "user_exists" email-link flow
            const fallbackFormRedirect = sessionStorage.getItem("ahcs_user_exists_form_redirect");
            if (fallbackFormRedirect) {
              sessionStorage.removeItem("ahcs_user_exists_form_redirect");
              try {
                const parsed = JSON.parse(fallbackFormRedirect);
                const fallbackTargetCaseId = String(parsed?.case_id || fallbackUrlCaseId || "").trim();
                if (fallbackTargetCaseId) {
                  localStorage.setItem("ahcs_selected_case_id", fallbackTargetCaseId);
                  refreshUserDetails().catch(() => {});
                }
                const redirectPath = getFormPath(parsed?.form ?? null);
                setLocation(redirectPath ?? "/");
              } catch {
                // Fallback: if not JSON, use raw value (backward compat)
                const redirectPath = getFormPath(fallbackFormRedirect);
                setLocation(redirectPath ?? "/");
              }
              return;
            }

            // Check if login is from sms no_user flow after password setup
            const fallbackSmsNoUserFormRedirect = sessionStorage.getItem("ahcs_sms_no_user_form_redirect");
            if (fallbackSmsNoUserFormRedirect) {
              sessionStorage.removeItem("ahcs_sms_no_user_form_redirect");
              sessionStorage.removeItem("ahcs_password_reset_flow");
              const redirectPath = getFormPath(fallbackSmsNoUserFormRedirect);
              setLocation(redirectPath ?? "/");
              return;
            }

            // Check if login is from password reset flow
            const fallbackIsPasswordReset = sessionStorage.getItem("ahcs_password_reset_flow");
            if (fallbackIsPasswordReset) {
              sessionStorage.removeItem("ahcs_password_reset_flow");
              setLocation("/");
            } else {
              // Redirect to original page if redirect param exists, otherwise home
              const fallbackParams = new URLSearchParams(window.location.search);
              const fallbackRedirect = fallbackParams.get("redirect");
              setLocation(fallbackRedirect ? decodeURIComponent(fallbackRedirect) : "/");
            }
          }
        }
      }
    } catch (error: any) {
      console.error("Login error:", error);
      const errorMessage = getApiErrorMessage(error);
      
      const isInvalidCredentials = errorMessage.toLowerCase() === "invalid credentials";
      
      toast({
        ...(isInvalidCredentials ? {} : { title: "Login Error" }),
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const logout = async () => {
    try {
      const data = await Apis.logout();

      if (data.success === true) {
        // Show success toast
        toast({
          description: "Logout successfully!",
          variant: "success",
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
      // Continue with logout even if API call fails
      toast({
        description: "Logout successfully!",
        variant: "success",
      });
    } finally {
      // Clear all storage and redirect
      setUser(null);
      localStorage.clear();
      sessionStorage.clear();
      setLocation("/login");
    }
  };

  // Pull the latest patient details from the profile API and update both the
  // in-memory user and the cached user data. Used after a funnel form is
  // submitted so the displayed name/email/phone reflect any edits, without
  // rotating the auth token.
  const refreshUserDetails = async (): Promise<void> => {
    try {
      const data = await Apis.getPatientDetails();

      if (!data || data.success === false) {
        return;
      }

      const details = data.patient_details || {};
      const fullName =
        details.full_name ||
        `${details.first_name || ""} ${details.last_name || ""}`.trim();

      setUser((previousUser) =>
        previousUser
          ? {
              ...previousUser,
              name: fullName || previousUser.name,
              email: details.email || previousUser.email,
            }
          : previousUser
      );

      const storedUserData = localStorage.getItem("ahcs_user_data");
      const parsedUserData = storedUserData ? JSON.parse(storedUserData) : {};

      localStorage.setItem(
        "ahcs_user_data",
        JSON.stringify({
          ...parsedUserData,
          name: fullName || parsedUserData.name || "",
          email: details.email || parsedUserData.email || "",
          phone: details.home_phone || parsedUserData.phone || "",
        })
      );
    } catch (error) {
      console.error("Failed to refresh user details:", error);
    }
  };

  // Check token expiration periodically
  useEffect(() => {
    const checkTokenExpiration = () => {
      const token = localStorage.getItem("ahcs_token");
      
      if (token && !isValidJWT(token)) {
        // Token has expired, logout user
        console.warn("Token expired during periodic check");
        setUser(null);
        localStorage.clear();
        sessionStorage.clear();
        setLocation("/login");
      }
    };

    // Check token expiration every minute
    const interval = setInterval(checkTokenExpiration, 60000);

    return () => clearInterval(interval);
  }, [setLocation]);

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUserDetails, isAuthenticated: !!user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Hook to get complete user data from localStorage.
// Reads synchronously in the useState initializer to avoid a second render
// (null → data) that would otherwise occur when using useEffect for the read.
export function useUserData(): UserData | null {
  const [userData] = React.useState<UserData | null>(() => {
    const stored = localStorage.getItem("ahcs_user_data");
    if (!stored) return null;
    try {
      return JSON.parse(stored) as UserData;
    } catch (error) {
      console.error("Error parsing user data:", error);
      return null;
    }
  });

  return userData;
}

