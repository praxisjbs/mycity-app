import { Icon, ModalProvider, Toaster } from "@mycity/ui";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { Login } from "@/auth/Login";
import { RouterProvider } from "@/lib/router";
import { StagingBar } from "@/components/ui/StagingBar";
import { Shell } from "@/shell/Shell";
import { UpdatePrompt } from "@/shell/UpdatePrompt";

export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <StagingBar />
          <Gate />
          <Toaster />
          <UpdatePrompt />
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>
  );
}

function Gate() {
  const { status } = useAuth();
  if (status === "loading") return <Splash />;
  if (status === "signed-out") return <Login />;
  return <Shell />;
}

/** While the refresh cookie is checked: the pin on Deep Green, the same as the installed app's splash. */
function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-deep" aria-busy="true" aria-label="Loading MyCity App">
      <Icon name="pin" className="size-12 animate-pulse text-primary" />
    </div>
  );
}
