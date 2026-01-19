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

import { FilesystemStorageAdapter } from '../../../../src/storage/filesystem-storage.adapter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';

describe('FilesystemStorageAdapter', () => {
    let adapter: FilesystemStorageAdapter;
    let tmpDir: string;

    beforeEach(() => {
        // Create a unique temp dir for each test
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ravhub-storage-test-'));
        adapter = new FilesystemStorageAdapter(tmpDir);
    });

    afterEach(() => {
        // Cleanup temp dir
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
            // ignore
        }
    });

    describe('save', () => {
        it('should save a buffer to a file', async () => {
            const key = 'folder/test.txt';
            const content = Buffer.from('hello world');
            const result = await adapter.save(key, content);

            expect(result.ok).toBe(true);
            const filePath = path.join(tmpDir, key);
            expect(fs.existsSync(filePath)).toBe(true);
            expect(fs.readFileSync(filePath)).toEqual(content);
        });

        it('should save a string content to a file', async () => {
            const key = 'string.txt';
            const content = 'some string content';
            const result = await adapter.save(key, content);

            expect(result.ok).toBe(true);
            expect(fs.readFileSync(path.join(tmpDir, key), 'utf8')).toBe(content);
        });

        it('should copy file if input string is an existing file path', async () => {
            // Create source file
            const sourceFile = path.join(tmpDir, 'source.txt');
            fs.writeFileSync(sourceFile, 'source content');

            const key = 'dest/copied.txt';
            const result = await adapter.save(key, sourceFile);

            expect(result.ok).toBe(true);
            expect(fs.readFileSync(path.join(tmpDir, key), 'utf8')).toBe('source content');
        });

        it('should handle errors gracefully', async () => {
            // Force error by trying to save to a path where a directory already exists
            const dirKey = 'some-dir';
            fs.mkdirSync(path.join(tmpDir, dirKey));

            const res = await adapter.save(dirKey, Buffer.from('fail'));
            // fs.writeFileSync usually throws EISDIR when writing to a directory
            expect(res.ok).toBe(false);
            expect(res.message).toEqual(expect.stringMatching(/EISDIR|EPERM/));
        });
    });

    describe('saveStream', () => {
        it('should save a stream and calculate hash/size', async () => {
            const key = 'stream.txt';
            const content = 'stream content';
            const stream = Readable.from([content]);

            const result = await adapter.saveStream(key, stream);

            expect(result.ok).toBe(true);
            expect(result.size).toBe(content.length);
            expect(result.contentHash).toBeDefined(); // sha256 of 'stream content'

            const fileContent = fs.readFileSync(path.join(tmpDir, key), 'utf8');
            expect(fileContent).toBe(content);
        });

        it('should handle stream errors', async () => {
            const key = 'stream-error.txt';
            const stream = new Readable({
                read() {
                    this.emit('error', new Error('Stream failed'));
                }
            });

            const result = await adapter.saveStream(key, stream);
            expect(result.ok).toBe(false);
        });
    });

    describe('get & exists', () => {
        it('should return null if key does not exist', async () => {
            expect(await adapter.get('missing')).toBeNull();
            expect(await adapter.exists('missing')).toBe(false);
        });

        it('should return buffer if key exists', async () => {
            const key = 'data.bin';
            fs.writeFileSync(path.join(tmpDir, key), 'data');

            const buffer = await adapter.get(key);
            expect(buffer).toBeInstanceOf(Buffer);
            expect(buffer?.toString()).toBe('data');
            expect(await adapter.exists(key)).toBe(true);
        });
    });

    describe('getUrl', () => {
        it('should return file:// url', async () => {
            const key = 'file.txt';
            const url = await adapter.getUrl(key);
            expect(url).toBe(`file://${path.join(tmpDir, key)}`);
        });
    });

    describe('list', () => {
        it('should list files recursively', async () => {
            // Setup structure:
            // /a.txt
            // /sub/b.txt
            // /sub/deep/c.txt
            fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
            fs.mkdirSync(path.join(tmpDir, 'sub', 'deep'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'sub', 'b.txt'), 'b');
            fs.writeFileSync(path.join(tmpDir, 'sub', 'deep', 'c.txt'), 'c');

            const results = await adapter.list('');
            // The implementation seems to list relative paths
            expect(results.sort()).toEqual([
                'a.txt',
                'sub/b.txt',
                'sub/deep/c.txt' // Check how relative paths are joined in actual impl
            ].sort());
        });

        it('should return empty list if prefix/dir does not exist', async () => {
            const results = await adapter.list('non-existent');
            expect(results).toEqual([]);
        });

        it('should return empty list on error (e.g. not a dir)', async () => {
            const fileKey = 'not-a-dir';
            fs.writeFileSync(path.join(tmpDir, fileKey), 'content');
            // Calling list on a file should likely behave gracefully or return empty
            // based on the implementation provided earlier: 
            // if exists(dest) check passes, then readdirSync throws ENOTDIR
            const results = await adapter.list(fileKey);
            expect(results).toEqual([]);
        });
    });

    describe('getMetadata', () => {
        it('should return metadata for existing file', async () => {
            const key = 'meta.txt';
            fs.writeFileSync(path.join(tmpDir, key), 'content');
            const meta = await adapter.getMetadata(key);
            expect(meta).not.toBeNull();
            expect(meta?.size).toBe(7);
            expect(meta?.mtime).toBeTruthy();
            expect(meta?.mtime.getTime()).toBeGreaterThan(0);
        });

        it('should return null for missing file', async () => {
            const meta = await adapter.getMetadata('none');
            expect(meta).toBeNull();
        });
    });

    describe('delete', () => {
        it('should delete file and return true', async () => {
            const key = 'del.txt';
            fs.writeFileSync(path.join(tmpDir, key), 'del');
            const res = await adapter.delete(key);
            expect(res).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, key))).toBe(false);
        });

        it('should return true even if file does not exist (idempotent)', async () => {
            const res = await adapter.delete('missing');
            expect(res).toBe(true);
        });

        it('should return false on error', async () => {
            // Force error by trying to delete a directory with implicit file handling
            const dirKey = 'some-dir-to-delete';
            fs.mkdirSync(path.join(tmpDir, dirKey));
            // unlinkSync allows deleting files only; on some platforms unlinkSync(dir) throws EPERM/EISDIR

            const res = await adapter.delete(dirKey);
            expect(res).toBe(false);
        });
    });
});
