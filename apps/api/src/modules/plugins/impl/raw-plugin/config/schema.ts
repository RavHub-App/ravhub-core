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
    {
      if: { properties: { type: { const: 'hosted' } } },
      then: {
        properties: {
          contentType: {
            type: 'string',
            title: 'Default content-type',
            description:
              'Default Content-Type header for served files (optional)',
          },
          readOnly: {
            type: 'boolean',
            title: 'Read-only',
            description: 'If true, uploading is disabled for this repository',
            default: false,
          },
          allowRedeploy: {
            type: 'boolean',
            title: 'Allow redeployment',
            description:
              'If checked, allows overwriting existing files. If unchecked, uploading a file with an existing path will fail.',
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
