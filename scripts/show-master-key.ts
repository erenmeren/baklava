import { resolveKeyMaterial } from "@/lib/crypto/master-key";

const { material, source } = resolveKeyMaterial();
if (source === "env") {
  console.log("Key source: env (BAKLAVA_MASTER_KEY). It is already in your environment — back that value up.");
} else {
  console.log(`Key source: ${source}`);
  console.log("Master key (set this as BAKLAVA_MASTER_KEY to restore on another machine):");
  console.log(material.toString("utf8"));
  console.log("\nKeep this secret. Anyone with it can decrypt your stored credentials.");
}
