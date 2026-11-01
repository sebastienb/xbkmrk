import AppHeader from "@/components/AppHeader";
import WelcomeChecklist from "@/components/WelcomeChecklist";

export const metadata = { title: "Welcome — X Bookmarks" };

export default function WelcomePage() {
  return (
    <>
      <AppHeader />
      <div className="ob-wrap">
        <h1>Welcome to your archive</h1>
        <p className="ob-intro">
          The stack is running — a few connections make it yours. Steps flip to ✓ as you
          complete them; only the first two matter to get going.
        </p>
        <WelcomeChecklist />
      </div>
    </>
  );
}
