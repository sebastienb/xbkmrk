import ConnectGuide from "@/components/ConnectGuide";

export const metadata = { title: "Connect your AI agent — X Bookmarks" };

export default function ConnectPage() {
  return <ConnectGuide mcpPort={process.env.NEXT_PUBLIC_MCP_PORT || "3021"} />;
}
