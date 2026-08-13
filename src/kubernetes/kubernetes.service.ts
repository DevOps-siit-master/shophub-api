import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';

/**
 * Minimal representation of a namespaced custom resource. Callers pass and get
 * back plain objects; typed accessors live in the shops layer.
 */
export interface CustomResource {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    resourceVersion?: string;
    creationTimestamp?: string;
    [key: string]: unknown;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Thin wrapper around the Kubernetes CustomObjects API. It centralises kube
 * config loading and error mapping so the shops layer can work with a small,
 * intention-revealing surface (create / list / get / replace / delete) without
 * knowing about the raw client or HTTP status codes.
 */
@Injectable()
export class KubernetesService implements OnModuleInit {
  private readonly logger = new Logger(KubernetesService.name);
  private readonly namespace: string;
  private api!: CustomObjectsApi;

  constructor(private readonly config: ConfigService) {
    this.namespace = this.config.get<string>('SHOP_NAMESPACE', 'shophub-shops');
  }

  onModuleInit(): void {
    const kc = new KubeConfig();
    // In a pod the service-account token/host are present → in-cluster config.
    // Locally fall back to the default kubeconfig (~/.kube/config or $KUBECONFIG).
    if (process.env.KUBERNETES_SERVICE_HOST) {
      kc.loadFromCluster();
      this.logger.log('Loaded in-cluster Kubernetes configuration');
    } else {
      kc.loadFromDefault();
      this.logger.log('Loaded default (local) Kubernetes configuration');
    }
    this.api = kc.makeApiClient(CustomObjectsApi);
  }

  get targetNamespace(): string {
    return this.namespace;
  }

  async create(
    group: string,
    version: string,
    plural: string,
    body: CustomResource,
  ): Promise<CustomResource> {
    try {
      return (await this.api.createNamespacedCustomObject({
        group,
        version,
        namespace: this.namespace,
        plural,
        body,
      })) as CustomResource;
    } catch (err) {
      throw this.mapError(err, plural, body.metadata?.name);
    }
  }

  async list(
    group: string,
    version: string,
    plural: string,
    labelSelector?: string,
  ): Promise<CustomResource[]> {
    try {
      const res = (await this.api.listNamespacedCustomObject({
        group,
        version,
        namespace: this.namespace,
        plural,
        labelSelector,
      })) as { items?: CustomResource[] };
      return res.items ?? [];
    } catch (err) {
      throw this.mapError(err, plural);
    }
  }

  async get(
    group: string,
    version: string,
    plural: string,
    name: string,
  ): Promise<CustomResource> {
    try {
      return (await this.api.getNamespacedCustomObject({
        group,
        version,
        namespace: this.namespace,
        plural,
        name,
      })) as CustomResource;
    } catch (err) {
      throw this.mapError(err, plural, name);
    }
  }

  async replace(
    group: string,
    version: string,
    plural: string,
    name: string,
    body: CustomResource,
  ): Promise<CustomResource> {
    try {
      return (await this.api.replaceNamespacedCustomObject({
        group,
        version,
        namespace: this.namespace,
        plural,
        name,
        body,
      })) as CustomResource;
    } catch (err) {
      throw this.mapError(err, plural, name);
    }
  }

  async delete(
    group: string,
    version: string,
    plural: string,
    name: string,
  ): Promise<void> {
    try {
      await this.api.deleteNamespacedCustomObject({
        group,
        version,
        namespace: this.namespace,
        plural,
        name,
      });
    } catch (err) {
      throw this.mapError(err, plural, name);
    }
  }

  /**
   * Best-effort delete that swallows "not found" — used for cleanup paths where
   * a resource may already be gone.
   */
  async deleteIfExists(
    group: string,
    version: string,
    plural: string,
    name: string,
  ): Promise<void> {
    try {
      await this.delete(group, version, plural, name);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return;
      }
      this.logger.warn(
        `Cleanup delete of ${plural}/${name} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Maps a raw client error onto a NestJS HTTP exception. The 1.x client throws
   * ApiException with a numeric `code`; we also probe a few other shapes to stay
   * resilient across client versions.
   */
  private mapError(err: unknown, plural: string, name?: string): Error {
    const status = this.statusCode(err);
    const target = name ? `${plural}/${name}` : plural;

    switch (status) {
      case 404:
        return new NotFoundException(`${target} not found`);
      case 409:
        return new ConflictException(`${target} already exists`);
      default: {
        const message = (err as { body?: { message?: string } })?.body?.message;
        this.logger.error(
          `Kubernetes API error on ${target} (status ${status ?? 'unknown'}): ${
            message ?? (err as Error)?.message ?? 'unknown error'
          }`,
        );
        return new InternalServerErrorException(
          'Kubernetes API request failed',
        );
      }
    }
  }

  private statusCode(err: unknown): number | undefined {
    const e = err as {
      code?: number;
      statusCode?: number;
      response?: { statusCode?: number };
      body?: { code?: number };
    };
    return e?.code ?? e?.statusCode ?? e?.response?.statusCode ?? e?.body?.code;
  }
}
