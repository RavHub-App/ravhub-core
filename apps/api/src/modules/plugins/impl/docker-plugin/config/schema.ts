/*
 * Copyright (C) 2026 RavHub Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */
export const configSchema = {
  type: 'object',
  allOf: [
    // Hosted: docker settings only
    {
      if: { properties: { type: { const: 'hosted' } } },
      then: {
        properties: {
          docker: {
            type: 'object',
            title: 'Docker registry settings',
            properties: {
              version: {
                type: 'string',
                title: 'Registry protocol version',
                enum: ['v2'],
                default: 'v2',
                description: 'Docker Registry V2 API',
                readOnly: true,
              },
              port: {
                type: 'number',
                title: 'Registry port',
                description:
                  'Port to expose this registry on. Set to 0 to auto-select a free ephemeral port; backend will validate that the port is not already in use by another repository.',
                default: 0,
                minimum: 0,
                maximum: 65535,
              },
              allowRedeploy: {
                type: 'boolean',
                title: 'Allow redeployment',
                description:
                  'If checked, allows overwriting existing package versions/tags. If unchecked, pushing an existing tag will fail.',
                default: true,
              },
            },
          },
        },
      },
    },
    // Proxy: docker settings + upstream + auth + cache
    {
      if: { properties: { type: { const: 'proxy' } } },
      then: {
        properties: {
          docker: {
            type: 'object',
            title: 'Docker registry settings',
            properties: {
              version: {
                type: 'string',
                title: 'Registry protocol version',
                enum: ['v2'],
                default: 'v2',
                readOnly: true,
              },
              port: {
                type: 'number',
                title: 'Registry port',
                description:
                  'Port to expose this repository registry on. Set to 0 to auto-select a free ephemeral port; backend will validate that the port is not already in use.',
                default: 0,
                minimum: 0,
                maximum: 65535,
              },
              proxyUrl: {
                type: 'string',
                title: 'Proxy URL',
                description:
                  'URL of the upstream Docker registry to proxy. Images are fetched from this URL and cached locally. Pushes are not allowed. Example: https://registry-1.docker.io or https://gcr.io',
                default: 'https://registry-1.docker.io',
                pattern: '^https?://.+',
              },
              isDockerHub: {
                type: 'boolean',
                title: 'Proxy repository is Docker Hub',
                default: false,
                description: 'Check this if the proxied registry is Docker Hub',
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
                    description:
                      'basic: username/password, bearer: token-based',
                  },
                },
                allOf: [
                  {
                    if: { properties: { type: { const: 'basic' } } },
                    then: {
                      properties: {
                        username: {
                          type: 'string',
                          title: 'Username',
                          description: 'Username for basic authentication',
                        },
                        password: {
                          type: 'string',
                          title: 'Password',
                          description: 'Password for basic authentication',
                          format: 'password',
                        },
                      },
                      required: ['username', 'password'],
                    },
                  },
                  {
                    if: { properties: { type: { const: 'bearer' } } },
                    then: {
                      properties: {
                        token: {
                          type: 'string',
                          title: 'Bearer token',
                          description: 'Authentication token for bearer auth',
                          format: 'password',
                        },
                      },
                      required: ['token'],
                    },
                  },
                ],
              },
            },
            required: ['proxyUrl'],
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
              'Recommended retention period for cached layers. Set to 0 to keep forever.',
            default: 7,
            minimum: 0,
          },
        },
      },
    },
    // Group: members + writePolicy + preferredWriter + cache
    {
      if: { properties: { type: { const: 'group' } } },
      then: {
        properties: {
          docker: {
            type: 'object',
            title: 'Docker registry settings',
            properties: {
              port: {
                type: 'number',
                title: 'Registry port',
                description:
                  'Port to expose this group registry on. Set to 0 to auto-select a free ephemeral port; backend will validate that the port is not already in use.',
                default: 0,
                minimum: 0,
                maximum: 65535,
              },
            },
          },
          members: {
            type: 'array',
            items: { type: 'string' },
            title: 'Group members',
            description:
              'Select Docker repositories (hosted or proxy) to include in this group. Only hosted and proxy repositories can be added; nested groups are not allowed to prevent recursion.',
            minItems: 1,
            'x-itemsSource': 'docker-repositories', // Hint for frontend: filter type !== 'group'
          },
          writePolicy: {
            type: 'string',
            enum: ['none', 'first', 'preferred', 'mirror', 'broadcast'],
            default: 'none',
            title: 'Write policy',
            description:
              'Determines how push operations are handled:\n• none: Read-only group\n• first: Write to first available\n• preferred: Write to preferred writer\n• mirror: Write to all members (replication)\n• broadcast: Write blobs to all, manifest to preferred',
            'x-enumDescriptions': {
              none: 'Read-only - No pushes allowed',
              first: 'Try members in order until success',
              preferred: 'Route all pushes to preferred writer',
              mirror: 'Write to all members (replication)',
              broadcast: 'Blobs to all, manifest to preferred',
            },
          },
          preferredWriter: {
            type: 'string',
            title: 'Preferred writer',
            description:
              'Repository ID to receive pushes when writePolicy is preferred or broadcast. Must be one of the members and must be a hosted repository.',
            'x-conditional': {
              field: 'writePolicy',
              value: ['preferred', 'broadcast'],
            },
          },
          cacheMaxAgeDays: {
            type: 'number',
            title: 'Cache retention policy (days)',
            description:
              'Recommended retention period for cached packages from member repositories. Set to 0 to keep forever. Automatic cleanup is not yet implemented, but this setting documents your retention policy. Note: Manifests by tag are always revalidated on each request to ensure you get the latest version.',
            default: 7,
            minimum: 0,
          },
        },
      },
    },
  ],
};
