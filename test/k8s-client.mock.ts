/**
 * Jest stub for `@kubernetes/client-node`.
 *
 * The real package ships as ESM-only, which ts-jest (CommonJS) cannot load. Our
 * tests never talk to a real cluster — unit tests mock `KubernetesService` and
 * the e2e test overrides it — so a minimal stub of the symbols imported by
 * `kubernetes.service.ts` is enough to satisfy the module graph.
 */
export class KubeConfig {
  loadFromCluster(): void {}
  loadFromDefault(): void {}
  makeApiClient(): unknown {
    return {};
  }
}

export class CustomObjectsApi {}
