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
    // Proxy: upstream + optional auth + cache
    {
      if: { properties: { type: { const: 'proxy' } } },
      then: {
        properties: {
          proxyUrl: {
            type: 'string',
            title: 'Proxy URL',
            default: 'https://charts.bitnami.com/bitnami',
            description:
              'Upstream Helm repository URL to proxy (e.g. https://charts.bitnami.com/bitnami).',
            pattern: '^https?://.+',
          },
          requireAuth: {
            type: 'boolean',
            title: 'Require upstream authentication',
            default: false,
            description:
              'Enable credentials if the upstream repository requires authentication.',
          },
          auth: {
            'x-conditional': { field: 'requireAuth', value: true },
            type: 'object',
            title: 'Upstream authentication',
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
    // Hosted: redeploy policy
    {
      if: { properties: { type: { const: 'hosted' } } },
      then: {
        properties: {
          allowRedeploy: {
            type: 'boolean',
            title: 'Allow redeployment',
            description:
              'If enabled, allows overwriting existing versions when uploading charts.',
            default: true,
          },
        },
      },
    },
    // Group: members + write policy
    {
      if: { properties: { type: { const: 'group' } } },
      then: {
        properties: {
          members: {
            type: 'array',
            items: { type: 'string' },
            title: 'Group members',
            description:
              'Repositorios Helm (hosted o proxy) incluidos en el grupo.',
            minItems: 1,
            'x-itemsSource': 'helm-repositories',
          },
          writePolicy: {
            type: 'string',
            enum: ['none', 'first', 'preferred', 'mirror'],
            default: 'none',
            title: 'Write policy',
            description:
              'none: solo lectura; first: escribir al primer hosted disponible; preferred: escribir al writer preferido; mirror: escribir a todos los hosted.',
          },
          preferredWriter: {
            type: 'string',
            title: 'Preferred writer',
            description:
              'Repositorio (ID) que recibe escrituras cuando writePolicy es preferred.',
            'x-conditional': { field: 'writePolicy', value: 'preferred' },
          },
        },
      },
    },
  ],
};
