import { TechGrid } from "@/components/tech-grid";
import { TECH_META_LIST } from "@/techs/meta-registry";
import { isDriverInstalled } from "@/techs/presence";

export default function Home() {
  const installed: Record<string, boolean> = Object.fromEntries(
    TECH_META_LIST.map((m) => [m.id, m.optionalDeps.every(isDriverInstalled)]),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6 pb-12">
      <TechGrid installed={installed} />
    </div>
  );
}
