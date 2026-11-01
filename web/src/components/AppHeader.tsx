"use client";

import Link from "next/link";
import AddBookmark from "./AddBookmark";
import StatusMenu from "./StatusMenu";
import ThemeToggle from "./ThemeToggle";
import { BookmarkIcon, BotIcon, GearIcon, NewspaperIcon } from "./icons";

// Shared top bar. `children` renders after the brand (e.g. tabs);
// `actions` renders with the icon cluster on the right.
export default function AppHeader({
  children,
  actions,
}: {
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/">
          <span className="brand-mark"><BookmarkIcon /></span>Bookmarks
        </Link>
        {children}
        <span style={{ flex: 1 }} />
        {actions}
        <AddBookmark />
        <StatusMenu />
        <Link className="icon-btn" href="/digest" title="The Weekly Bookmark — your Friday digest"><NewspaperIcon /></Link>
        <Link className="icon-btn" href="/connect" title="Connect your AI agent"><BotIcon /></Link>
        <Link className="icon-btn" href="/settings" title="Settings"><GearIcon /></Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
