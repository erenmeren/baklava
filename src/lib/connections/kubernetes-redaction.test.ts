import { describe, it, expect, vi, beforeEach } from "vitest";

// The driver layer is normally exercised by the integration suite, but the
// Secret-value redaction in readResourceYaml is a security guard: if the
// `kind === "Secret"` condition or the data/stringData deletion ever
// regresses, secret values leak to the AI. That pure transform is worth a
// direct unit test, so we stub @kubernetes/client-node's object API and keep
// the real dumpYaml/loadYaml so we assert on the actual rendered YAML.

const mockRead = vi.fn();
const mockDelete = vi.fn();
const mockReplace = vi.fn();

vi.mock("@kubernetes/client-node", async (importActual) => {
  const actual =
    await importActual<typeof import("@kubernetes/client-node")>();
  class FakeKubeConfig {
    loadFromString() {}
    loadFromFile() {}
    setCurrentContext() {}
    makeApiClient() {
      return {};
    }
  }
  return {
    ...actual,
    KubeConfig: FakeKubeConfig,
    CoreV1Api: class {},
    AppsV1Api: class {},
    VersionApi: class {},
    KubernetesObjectApi: {
      makeApiClient: () => ({
        read: mockRead,
        delete: mockDelete,
        replace: mockReplace,
      }),
    },
  } as unknown as typeof import("@kubernetes/client-node");
});

import {
  readResourceYaml,
  replaceResourceYaml,
  deleteResource,
  dropKubernetesClient,
} from "./kubernetes";

const cfg = { source: "inline" as const, kubeconfigYaml: "fake-kubeconfig" };

function secretObject() {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "db-creds",
      namespace: "default",
      managedFields: [{}],
      uid: "abc",
      annotations: {
        // `kubectl apply` mirrors the full manifest (with base64 data) here.
        "kubectl.kubernetes.io/last-applied-configuration":
          '{"apiVersion":"v1","kind":"Secret","data":{"password":"c3VwZXJzZWNyZXQ="}}',
        "app.example/owner": "team-a",
      },
    },
    data: { password: "c3VwZXJzZWNyZXQ=" },
    stringData: { token: "plaintext-token" },
  };
}

describe("readResourceYaml — Secret value redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropKubernetesClient("c1");
  });

  it("strips data and stringData from a Secret when redaction is requested", async () => {
    mockRead.mockResolvedValue(secretObject());
    const yaml = await readResourceYaml(
      "c1",
      cfg as never,
      "secret",
      "default",
      "db-creds",
      { redactSecretValues: true },
    );
    expect(yaml).toMatch(/kind: Secret/);
    // The structural shell survives, the secret material does not — including
    // the copy smuggled in the last-applied-configuration annotation.
    expect(yaml).not.toMatch(/c3VwZXJzZWNyZXQ=/);
    expect(yaml).not.toMatch(/plaintext-token/);
    expect(yaml).not.toMatch(/stringData/);
    expect(yaml).not.toMatch(/last-applied-configuration/);
    // Non-secret annotations are preserved.
    expect(yaml).toMatch(/app\.example\/owner/);
  });

  it("keeps Secret values when redaction is NOT requested (policy opt-in path)", async () => {
    mockRead.mockResolvedValue(secretObject());
    const yaml = await readResourceYaml(
      "c1",
      cfg as never,
      "secret",
      "default",
      "db-creds",
      {},
    );
    expect(yaml).toMatch(/c3VwZXJzZWNyZXQ=/);
    expect(yaml).toMatch(/plaintext-token/);
  });

  it("does NOT strip data from a non-Secret (ConfigMap) even with the flag set", async () => {
    // Guards the `k.kind === "Secret"` condition — ConfigMap data is not
    // secret material and must never be redacted.
    mockRead.mockResolvedValue({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "app-config", namespace: "default" },
      data: { "log.level": "value-not-secret" },
    });
    const yaml = await readResourceYaml(
      "c1",
      cfg as never,
      "configmap",
      "default",
      "app-config",
      { redactSecretValues: true },
    );
    expect(yaml).toMatch(/value-not-secret/);
  });
});

describe("replaceResourceYaml — redacted-Secret round-trip guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropKubernetesClient("c3");
  });

  it("refuses to apply a Secret with no data/stringData (would wipe it)", async () => {
    const redacted = [
      "apiVersion: v1",
      "kind: Secret",
      "metadata:",
      "  name: db-creds",
      "  namespace: default",
      "",
    ].join("\n");
    await expect(
      replaceResourceYaml("c3", cfg as never, redacted),
    ).rejects.toThrow(/redacted view|wipe the Secret/i);
    // Refusal happens before touching the cluster.
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("allows a Secret that still carries data", async () => {
    mockRead.mockResolvedValue({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "db-creds", namespace: "default", resourceVersion: "42" },
    });
    const withData = [
      "apiVersion: v1",
      "kind: Secret",
      "metadata:",
      "  name: db-creds",
      "  namespace: default",
      "data:",
      "  password: c3VwZXJzZWNyZXQ=",
      "",
    ].join("\n");
    await replaceResourceYaml("c3", cfg as never, withData);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});

describe("deleteResource — kind resolution and namespacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropKubernetesClient("c2");
  });

  it("issues a namespaced delete spec for namespaced kinds", async () => {
    await deleteResource("c2", cfg as never, "pod", "default", "nginx");
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "nginx", namespace: "default" },
      }),
    );
  });

  it("omits namespace for cluster-scoped kinds", async () => {
    await deleteResource("c2", cfg as never, "namespace", "ignored", "team-a");
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "Namespace",
        metadata: { name: "team-a", namespace: undefined },
      }),
    );
  });
});
