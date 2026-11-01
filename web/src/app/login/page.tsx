import { Suspense } from "react";
import { getAuthConfig } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — X Bookmarks" };

// setup mode is resolved server-side so the password inputs are present in
// the initial HTML — password managers (1Password's new-password generator
// in particular) don't reliably detect fields injected after page load.
export default async function LoginPage() {
  const cfg = await getAuthConfig();
  return (
    <Suspense>
      <LoginForm setup={cfg.passwordHash === null} />
    </Suspense>
  );
}
