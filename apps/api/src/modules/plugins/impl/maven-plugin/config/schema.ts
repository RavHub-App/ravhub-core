export const configSchema = {
  type: 'object',
  allOf: [
    {
      if: { properties: { type: { const: 'proxy' } } },
      then: {
        type: 'object',
        properties: {
          proxyUrl: {
            type: 'string',
            title: 'Proxy URL',
            description: 'Optional upstream registry/proxy URL to use',
            default: 'https://repo.maven.apache.org/maven2',
          },
          requireAuth: {
            type: 'boolean',
            title: 'Require proxy repository authentication',
            default: false,
            description:
              'Enable proxy repository authentication settings when checked',
          },
          auth: {
            'x-conditional': { field: 'requireAuth', value: true },
            type: 'object',
            title: 'Proxy repository authentication',
            description:
              'Configure authentication if the upstream registry requires credentials',
            properties: {
              type: {
                type: 'string',
                enum: ['basic', 'bearer'],
                default: 'basic',
                title: 'Authentication type',
              },
            },
            allOf: [
              {
                if: { properties: { type: { const: 'basic' } } },
                then: {
                  type: 'object',
                  properties: {
                    username: { type: 'string', title: 'Username' },
                    password: {
                      type: 'string',
                      title: 'Password',
                      format: 'password',
                    },
                  },
                  required: ['username', 'password'],
                },
              },
              {
                if: { properties: { type: { const: 'bearer' } } },
                then: {
                  type: 'object',
                  properties: {
                    token: {
                      type: 'string',
                      title: 'Bearer token',
                      format: 'password',
                    },
                  },
                  required: ['token'],
                },
              },
            ],
          },
          cacheEnabled: {
            type: 'boolean',
            title: 'Enable caching',
            description: 'Cache artifacts from the upstream registry',
            default: true,
          },
          cacheMaxAgeDays: {
            'x-conditional': { field: 'cacheEnabled', value: true },
            type: 'number',
            title: 'Cache retention policy (days)',
            description:
              'Recommended retention period for cached packages. Set to 0 to keep forever.',
            default: 7,
            minimum: 0,
          },
        },
        required: ['proxyUrl'],
      },
    },
    {
      if: { properties: { type: { const: 'hosted' } } },
      then: {
        properties: {
          allowRedeploy: {
            type: 'boolean',
            title: 'Allow redeployment',
            description:
              'If checked, allows overwriting existing package versions. If unchecked, uploading an existing version will fail.',
            default: true,
          },
        },
      },
    },
    {
      if: { properties: { type: { const: 'group' } } },
      then: {
        properties: {
          members: {
            type: 'array',
            items: { type: 'string' },
            title: 'Group members',
            description: 'Select repositories to include in this group.',
          },
          writePolicy: {
            type: 'string',
            enum: ['none', 'first', 'preferred', 'mirror'],
            default: 'none',
            title: 'Write policy',
            description:
              'Determines how push operations are handled:\n• none: Read-only group\n• first: Write to first available\n• preferred: Write to preferred writer\n• mirror: Write to all members (replication)',
          },
          preferredWriter: {
            type: 'string',
            title: 'Preferred writer',
            description:
              'Repository ID to receive pushes when writePolicy is preferred.',
            'x-conditional': { field: 'writePolicy', value: 'preferred' },
          },
        },
      },
    },
  ],
};
