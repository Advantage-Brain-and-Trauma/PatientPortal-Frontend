import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import Login from "@/pages/Login";
import LoadingSpinner from "@/components/LoadingSpinner";
import AdminLayout from "@/components/AdminLayout";
import Dashboard from "@/pages/admin/Dashboard";
import UserManagement from "@/pages/admin/UserManagement";
import Reports from "@/pages/admin/Reports";
import AdminSettings from "@/pages/admin/AdminSettings";
import PatientDashboard from "@/pages/PatientDashboard";
import Appointments from "@/pages/Appointments";
import Messages from "@/pages/Messages";
import Health from "@/pages/Health";
import Billing from "@/pages/Billing";
import Documents from "@/pages/Documents";
import PatientFunnelForm from "@/pages/PatientFunnelForm";
import Profile from "@/pages/Profile";
import Learning from "@/pages/Learning";
import Layout from "@/components/Layout";
import StaffDashboard from "@/pages/StaffDashboard";
import NotFound from "@/pages/not-found";
import ResetPassword from "@/pages/ResetPassword";
import { TokenValidator } from "@/components/TokenValidator";
import { EmailLinkHandler } from "@/components/EmailLinkHandler";
import MultipleFunnelSelectionModal from "@/components/MultipleFunnelSelectionModal";
import PatientChatWidget from "@/components/chat/PatientChatWidget";

function ProtectedRoute({ component: Component, allowedRoles }: { component: React.ComponentType, allowedRoles: string[] }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [currentPath, setLocation] = useLocation();

  const roleMap: Record<string, string> = {
    admin: "admin",
    staff: "staff",
    user: "patient",
  };
  const role = roleMap[user?.role?.toLowerCase() || ""] || "patient";
  const hasRequiredRole = allowedRoles.includes(role);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      // Redirect to login - skip redirect param for root route
      if (currentPath === "/" || currentPath === "/login") {
        setLocation("/login");
      } else {
        setLocation(`/login?redirect=${encodeURIComponent(currentPath)}`);
      }
      return;
    }

    if (!hasRequiredRole) {
      // Redirect to appropriate dashboard based on role
      if (role === "admin") setLocation("/admin");
      else if (role === "staff") setLocation("/staff");
      else setLocation("/");
    }
  }, [isLoading, isAuthenticated, hasRequiredRole, role, currentPath, setLocation]);

  // Show loading spinner while auth is being initialized
  if (isLoading) {
    return <LoadingSpinner />;
  }

  // While unauthenticated or role-mismatched, render nothing and let the
  // effect above handle the redirect (avoids setState-during-render).
  if (!isAuthenticated || !hasRequiredRole) {
    return null;
  }

  return <Component />;
}

function Router() {
  const { isLoading, isAuthenticated } = useAuth();
  const [location] = useLocation();

  // Show loading spinner while auth is being initialized
  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <Switch>
      {/* Public Routes */}
      <Route path="/login" component={Login} />
      <Route path="/reset-password" component={ResetPassword} />

      {/* Patient Routes - More specific routes first */}
      <Route path="/appointments">
        <Layout>
          <ProtectedRoute component={Appointments} allowedRoles={["patient"]} />
        </Layout>
      </Route>
      <Route path="/messages">
        <Layout>
          <ProtectedRoute component={Messages} allowedRoles={["patient"]} />
        </Layout>
      </Route>
      <Route path="/health">
        <Layout>
          <ProtectedRoute component={Health} allowedRoles={["patient"]} />
        </Layout>
      </Route>
      <Route path="/billing">
        <Layout>
          <ProtectedRoute component={Billing} allowedRoles={["patient"]} />
        </Layout>
      </Route>
      <Route path="/documents">
        <Layout>
          <ProtectedRoute component={Documents} allowedRoles={["patient"]} />
        </Layout>
      </Route>
      <Route path="/form/:funnelId">
        <Layout>
          <ProtectedRoute component={PatientFunnelForm} allowedRoles={["patient", "admin"]} />
        </Layout>
      </Route>
      <Route path="/profile">
        <Layout>
          <ProtectedRoute component={Profile} allowedRoles={["patient"]} />
        </Layout>
      </Route>
      <Route path="/learning">
        <Layout>
          <ProtectedRoute component={Learning} allowedRoles={["patient"]} />
        </Layout>
      </Route>
      {/* Root dashboard route - least specific, placed last */}
      <Route path="/">
        <Layout>
          <ProtectedRoute component={PatientDashboard} allowedRoles={["patient"]} />
        </Layout>
      </Route>

      {/* Staff Routes */}
      <Route path="/staff">
        <ProtectedRoute component={StaffDashboard} allowedRoles={["staff"]} />
      </Route>

      {/* Admin Routes */}
      <Route path="/admin">
        <AdminLayout>
          <ProtectedRoute component={Dashboard} allowedRoles={["admin"]} />
        </AdminLayout>
      </Route>
      <Route path="/admin/users">
        <AdminLayout>
          <ProtectedRoute component={UserManagement} allowedRoles={["admin"]} />
        </AdminLayout>
      </Route>
      <Route path="/admin/reports">
        <AdminLayout>
          <ProtectedRoute component={Reports} allowedRoles={["admin"]} />
        </AdminLayout>
      </Route>
      <Route path="/admin/settings">
        <AdminLayout>
          <ProtectedRoute component={AdminSettings} allowedRoles={["admin"]} />
        </AdminLayout>
      </Route>

      {/* Fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  return (
    <EmailLinkHandler>
      <TokenValidator>
        <Router />
        {/* App-level host: opens over any route once a multiple-funnel magic
            link continuation is pending and the patient is authenticated. */}
        <MultipleFunnelSelectionModal />
        {/* App-level host so the chat survives route changes; renders only for
            authenticated patients outside the login/reset screens. */}
        <PatientChatWidget />
        <Toaster />
        <SonnerToaster
          position="top-right"
          expand={true}
          toastOptions={{
            style: { zIndex: 99999 },
          }}
        />
      </TokenValidator>
    </EmailLinkHandler>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
  );
}
export default App;
