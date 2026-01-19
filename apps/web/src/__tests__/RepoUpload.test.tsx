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

import React from 'react';
import { render, screen, fireEvent, waitFor } from '../test-utils';
import RepoUpload from '../components/Repos/RepoUpload';
import { NotificationProvider } from '../components/NotificationSystem';
import axios from 'axios';
import { vi } from 'vitest';

vi.mock('axios');

describe('RepoUpload component', () => {
    beforeEach(() => vi.resetAllMocks());

    it('uploads file and shows success message', async () => {
        const repoId = 'r-upload-1';

        (axios.post as any).mockResolvedValue({ status: 200, data: { ok: true } });

        const { container } = render(
            <NotificationProvider>
                <RepoUpload repoId={repoId} />
            </NotificationProvider>
        );

        // find file input (hidden) and simulate selecting a file
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).toBeTruthy();

        const testFile = new File(['hello'], 'hello.txt', { type: 'text/plain' });
        // fire change event
        fireEvent.change(fileInput, { target: { files: [testFile] } });

        // click Upload
        const uploadBtn = screen.getByRole('button', { name: /Upload/i });
        fireEvent.click(uploadBtn);

        await waitFor(() => expect(axios.post).toHaveBeenCalled());

        const calledUrl = (axios.post as any).mock.calls[0][0];
        expect(calledUrl).toContain(`/api/repository/${repoId}/upload`);

        const successMsg = await screen.findByText('Upload successful!');
        expect(successMsg).toBeInTheDocument();
    });

    it('shows error message when upload fails', async () => {
        const repoId = 'r-upload-err';

        (axios.post as any).mockRejectedValue(new Error('upload failed'));

        const { container } = render(
            <NotificationProvider>
                <RepoUpload repoId={repoId} />
            </NotificationProvider>
        );

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        const testFile = new File(['x'], 'x.bin', { type: 'application/octet-stream' });
        fireEvent.change(fileInput, { target: { files: [testFile] } });

        const uploadBtn = screen.getByRole('button', { name: /Upload/i });
        fireEvent.click(uploadBtn);

        await waitFor(() => expect(axios.post).toHaveBeenCalled());

        const errMsg = await screen.findByText('Upload failed. Please check repository logs.');
        expect(errMsg).toBeInTheDocument();
    });
});
