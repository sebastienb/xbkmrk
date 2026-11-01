import AppHeader from "@/components/AppHeader";
import AppearanceSettings from "@/components/AppearanceSettings";
import BookmarkletSettings from "@/components/BookmarkletSettings";
import ShortcutSettings from "@/components/ShortcutSettings";
import SecuritySettings from "@/components/SecuritySettings";
import SettingsForm from "@/components/SettingsForm";
import XUsageMeter from "@/components/XUsageMeter";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings — X Bookmarks" };

export default function SettingsPage() {
  return (
    <>
      <AppHeader />
      <div className="reading-wrap connect-page">
        <h1>Settings</h1>
        <p className="lede">App configuration — applied live, no restart needed.</p>
        <AppearanceSettings />
        <BookmarkletSettings />
        <ShortcutSettings />
        <SecuritySettings />
        <XUsageMeter />
        <SettingsForm />
      </div>
    </>
  );
}
