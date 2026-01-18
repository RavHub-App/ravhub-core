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

import {
  initiateUpload,
  appendUpload,
  finalizeUpload,
  initUpload,
} from 'src/modules/plugins/impl/docker-plugin/storage/upload';
import * as fs from 'fs';

jest.mock('fs', () => {
  return {
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    createReadStream: jest.fn(),
    createWriteStream: jest.fn(),
    readFileSync: jest.fn(() => Buffer.from('content')),
    statSync: jest.fn(() => ({ size: 100 })),
    unlinkSync: jest.fn(),
  };
});
jest.mock('os', () => ({ tmpdir: () => '/mock-tmp' }));

describe('Docker Plugin - Upload Storage (Unit)', () => {
  let mockStorage: any;

  beforeAll(() => {
    mockStorage = {
      save: jest.fn(async () => ({ size: 100, contentHash: 'abc' })),
    };
    initUpload({ storage: mockStorage, getRepo: jest.fn() });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  it('should initiate upload', async () => {
    const res = await initiateUpload(
      { id: 'r1', type: 'hosted' } as any,
      'img',
    );
    expect(res.ok).toBeTruthy();
    expect(res.uuid).toBeDefined();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should append upload', async () => {
    const res = await appendUpload(
      { id: 'r1' } as any,
      'uuid',
      undefined,
      Buffer.from('data'),
    );
    expect(res.ok).toBeTruthy();
    expect(fs.appendFileSync).toHaveBeenCalled();
  });

  it('should fail append if file missing', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const res = await appendUpload(
      { id: 'r1' } as any,
      'uuid',
      undefined,
      Buffer.from('data'),
    );
    expect(res.ok).toBeFalsy();
    expect(res.message).toMatch(/not found/);
  });

  it('should finalize upload', async () => {
    // Mock stream for hash calculation (createReadStream is called twice: once for hash, once for upload)
    const mockHashStream = {
      on: jest.fn((evt, cb) => {
        if (evt === 'end') cb();
        return mockHashStream;
      }),
    };
    // Mock stream for storage upload (passed to storage.save or pipeline)
    const mockUploadStream = { pipe: jest.fn() };

    (fs.createReadStream as jest.Mock)
      .mockReturnValueOnce(mockHashStream)
      .mockReturnValueOnce(mockUploadStream);

    const res = await finalizeUpload(
      { id: 'r1' } as any,
      'img',
      'uuid',
      undefined,
      Buffer.from('last'),
    );

    expect(res.ok).toBeTruthy();
    expect(res.metadata?.storageKey).toContain('blobs');
    expect(fs.unlinkSync).toHaveBeenCalled(); // Should cleanup temp file
  });
});
