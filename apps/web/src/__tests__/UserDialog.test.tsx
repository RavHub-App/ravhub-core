import { renderWithProviders, screen, fireEvent, waitFor } from '../test-utils';
import UserDialog from '../components/Users/UserDialog';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios');

describe('UserDialog', () => {
    const mockOnClose = vi.fn();
    const mockOnSaved = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (axios.get as any).mockResolvedValue({ data: [] }); // Mock roles fetch
    });

    it('renders correctly when open', () => {
        renderWithProviders(<UserDialog open={true} onClose={mockOnClose} onSaved={mockOnSaved} />);
        // Dialog title and button share the same label; assert presence of heading
        expect(screen.getByRole('heading', { name: /Create User/i })).toBeInTheDocument();
    });

    it('submits form correctly for create', async () => {
        (axios.post as any).mockResolvedValue({ data: { id: '1' } });

        renderWithProviders(<UserDialog open={true} onClose={mockOnClose} onSaved={mockOnSaved} />);

        fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'testuser' } });
        fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: 'Test User' } });
        fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password123' } });

        fireEvent.click(screen.getByRole('button', { name: /Create User/i }));

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith('/api/users', expect.objectContaining({
                username: 'testuser',
                displayName: 'Test User',
                password: 'password123'
            }));
            expect(mockOnSaved).toHaveBeenCalled();
            expect(mockOnClose).toHaveBeenCalled();
        });
    });
});
