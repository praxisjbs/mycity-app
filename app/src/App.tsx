import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { Login } from "@/auth/Login";
import { IconSprite } from "@/components/ui/Icon";
import { ModalProvider } from "@/components/ui/Modal";
import { Toasts } from "@/components/ui/Toast";
import { RouterProvider } from "@/lib/router";
import { StagingBar } from "@/components/ui/StagingBar";
import { Shell } from "@/shell/Shell";
import { UpdatePrompt } from "@/shell/UpdatePrompt";

export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <IconSprite />
          <StagingBar />
          <Gate />
          <Toasts />
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
      <svg viewBox="0 0 24 24" className="size-12 animate-pulse text-primary" aria-hidden="true">
        <use href="#i-pin" />
      </svg>
    </div>
  );
}
