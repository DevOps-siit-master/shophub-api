import * as Joi from 'joi';

/**
 * Validation schema for environment variables.
 *
 * This service is stateless — shop state lives in the cluster as Shop / Wallet /
 * DiscordChannel custom resources, so there is no database configuration here.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3001),

  // JWT — must match JWT_ACCESS_SECRET of shophub-auth-service so access tokens
  // issued there are accepted here.
  JWT_ACCESS_SECRET: Joi.string().required(),

  // Kubernetes — namespace the Shop/Wallet/DiscordChannel CRs are created in.
  // The operator must watch this namespace.
  SHOP_NAMESPACE: Joi.string().default('shophub-shops'),

  // Optional explicit kubeconfig path for local development. When unset the
  // client falls back to in-cluster config (in a pod) or the default kubeconfig
  // (~/.kube/config or $KUBECONFIG) locally.
  KUBECONFIG: Joi.string().optional(),

  // Template used to build the public URL of a deployed shop. `{name}` is
  // replaced with the Shop CR name.
  SHOP_URL_TEMPLATE: Joi.string().default('http://{name}.localhost'),

  // Optional CORS origin. When unset the browser is expected to reach this API
  // same-origin via the frontend dev proxy / ingress.
  CORS_ORIGIN: Joi.string().optional(),
});
