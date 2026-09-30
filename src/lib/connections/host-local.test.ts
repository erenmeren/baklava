import { describe, it, expect } from "vitest";
import { hostLocalReason, touchesLocation } from "./host-local";

const kubeconfig = (user: string) => `
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://k8s.example:6443
    certificate-authority-data: AAAA
users:
- name: u
  user:
${user}
contexts:
- name: ctx
  context: { cluster: c, user: u }
current-context: ctx
`;

describe("hostLocalReason", () => {
  it("docker: socket mode (or no mode) reaches the host, tcp does not", () => {
    expect(hostLocalReason("docker", { mode: "socket" })).toMatch(/socket/);
    expect(hostLocalReason("docker", {})).toMatch(/socket/);
    expect(hostLocalReason("docker", { mode: "tcp", host: "h", port: 2375 })).toBeNull();
  });

  it("kubernetes: a kubeconfig path reads the host's file", () => {
    expect(hostLocalReason("kubernetes", { source: "path", kubeconfigPath: "~/.kube/config" })).toMatch(
      /file/,
    );
  });

  it("kubernetes: an inline token kubeconfig is fine", () => {
    const yaml = kubeconfig("    token: abc");
    expect(hostLocalReason("kubernetes", { source: "inline", kubeconfigYaml: yaml })).toBeNull();
  });

  it.each([
    ["exec", "    exec:\n      command: /bin/sh\n      args: ['-c', 'id']"],
    ["auth-provider", "    auth-provider:\n      name: oidc"],
    ["token-file", "    token-file: /home/u/.baklava/master.key"],
    ["client-key", "    client-key: /etc/ssl/private/k.pem"],
  ])("kubernetes: inline `%s` reaches the host", (key, user) => {
    const reason = hostLocalReason("kubernetes", { source: "inline", kubeconfigYaml: kubeconfig(user) });
    expect(reason).toContain(key);
  });

  it("kubernetes: a file-backed CA on the cluster entry reaches the host", () => {
    const yaml = kubeconfig("    token: abc").replace(
      "certificate-authority-data: AAAA",
      "certificate-authority: /etc/shadow",
    );
    expect(hostLocalReason("kubernetes", { source: "inline", kubeconfigYaml: yaml })).toContain(
      "certificate-authority",
    );
  });

  it("kubernetes: unparseable YAML fails closed", () => {
    expect(hostLocalReason("kubernetes", { source: "inline", kubeconfigYaml: "a: [" })).not.toBeNull();
  });

  it("other techs never reach the host", () => {
    expect(hostLocalReason("postgres", { host: "localhost" })).toBeNull();
  });
});

describe("touchesLocation", () => {
  it("is true only for keys that choose where the connection points", () => {
    expect(touchesLocation("docker", ["socketPath"])).toBe(true);
    expect(touchesLocation("docker", ["protocol"])).toBe(false);
    expect(touchesLocation("kubernetes", ["kubeconfigYaml"])).toBe(true);
    expect(touchesLocation("kubernetes", ["namespace"])).toBe(false);
    expect(touchesLocation("postgres", ["host"])).toBe(false);
  });
});
