import { headers } from "next/headers";
import { TechGrid } from "@/components/tech-grid";
import { TECH_META_LIST } from "@/techs/meta-registry";
import { isDriverInstalled } from "@/techs/presence";
import { isInstallAllowed } from "@/lib/techs/install";

export default async function Home() {
  const installed: Record<string, boolean> = {};
  const optionalDeps: Record<string, string[]> = {};
  for (const m of TECH_META_LIST) {
    installed[m.id] = m.optionalDeps.every(isDriverInstalled);
    optionalDeps[m.id] = m.optionalDeps;
  }
  const canInstall = isInstallAllowed((await headers()).get("host"));

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6 pb-12">
      <TechGrid installed={installed} optionalDeps={optionalDeps} canInstall={canInstall} />
    </div>
  );
}
