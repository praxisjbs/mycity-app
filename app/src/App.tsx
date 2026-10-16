import { Brand, ModalProvider, StagingBar, Toaster, useEnvironment } from "@mycity/ui";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { Login } from "@/auth/Login";
import { SignInSheet } from "@/auth/SignInSheet";
import { RouterProvider } from "@/lib/router";
import { Shell } from "@/shell/Shell";

export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Staging />
          <Gate />
          <Toaster />
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>
  );
}

/** The staging bar (MILESTONES §6), above everything on every screen, sign-in included. Nothing on production. */
function Staging() {
  if (useEnvironment() !== "staging") return null;
  return <StagingBar message="For training and testing. Every feature works and mail reaches real people." short="Mail here is real" />;
}

function Gate() {
  const { status } = useAuth();
  if (status === "loading") return <Splash />;
  if (status === "signed-out") return <Login />;
  return (
    <>
      <Shell />
      <SignInSheet />
    </>
  );
}

/** While the refresh cookie is checked: the pin on Deep Green, the same as the installed app's splash. */
function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-deep" aria-busy="true" aria-label="Loading MyCity App">
      <Brand tone="on-dark" size="xl" className="animate-pulse" />
    </div>
  );
}
