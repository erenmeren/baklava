import type { Metadata } from "next";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = {
  title: "Dashboard · Baklava",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
