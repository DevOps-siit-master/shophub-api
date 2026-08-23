/**
 * Self-contained Shop CustomResourceDefinition used by the integration tests.
 *
 * It mirrors the schema the shop-operator installs (spec.wallet.address +
 * spec.discordChannel), but is embedded here so the shophub-api integration
 * suite does not depend on the operator repo being checked out. The status
 * subresource is enabled so the API's status reads behave as in a real cluster.
 */
export const SHOP_CRD = {
  apiVersion: 'apiextensions.k8s.io/v1',
  kind: 'CustomResourceDefinition',
  metadata: { name: 'shops.shophub.devops-siit.io' },
  spec: {
    group: 'shophub.devops-siit.io',
    names: {
      kind: 'Shop',
      listKind: 'ShopList',
      plural: 'shops',
      singular: 'shop',
    },
    scope: 'Namespaced',
    versions: [
      {
        name: 'v1',
        served: true,
        storage: true,
        subresources: { status: {} },
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  displayName: { type: 'string' },
                  availability: {
                    type: 'string',
                    enum: ['standard', 'high'],
                  },
                  databaseType: {
                    type: 'string',
                    enum: ['standard', 'light'],
                  },
                  wallet: {
                    type: 'object',
                    properties: { address: { type: 'string' } },
                    required: ['address'],
                  },
                  discordChannel: {
                    type: 'object',
                    properties: {
                      channelName: { type: 'string' },
                      serverID: { type: 'string' },
                    },
                    required: ['channelName', 'serverID'],
                  },
                },
                required: ['wallet', 'discordChannel'],
              },
              status: {
                type: 'object',
                properties: {
                  ready: { type: 'boolean' },
                  replicas: { type: 'integer' },
                },
                'x-kubernetes-preserve-unknown-fields': true,
              },
            },
          },
        },
      },
    ],
  },
};
