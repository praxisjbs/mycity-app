import { Brand, ModalProvider, Toaster } from "@mycity/ui";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { LINK_PATHS, Login } from "@/auth/Login";
import { LockSheet } from "@/auth/LockSheet";
import { RouterProvider, useRouter } from "@/lib/router";
import { Shell } from "@/shell/Shell";

export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Gate />
          <Toaster />
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>
  );
}

function Gate() {
  const { status } = useAuth();
  const { location } = useRouter();
  if (status === "loading") return <Splash />;
  // A reset or invitation link opens its own page, whoever is signed in on this browser.
  if (status === "signed-out" || LINK_PATHS.includes(location.path)) return <Login />;
  return (
    <>
      <Shell />
      <LockSheet />
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
