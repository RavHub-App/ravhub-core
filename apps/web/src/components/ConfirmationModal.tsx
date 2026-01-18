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

import * as React from 'react';
import { Modal, ModalDialog, DialogTitle, DialogContent, Divider, Box, Button } from '@mui/joy';
import WarningIcon from '@mui/icons-material/Warning';

interface ConfirmationModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    color?: 'primary' | 'danger' | 'warning';
    confirmText?: string;
    cancelText?: string;
    loading?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    open,
    onClose,
    onConfirm,
    title,
    message,
    color = 'primary',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    loading = false
}) => {
    return (
        <Modal open={open} onClose={onClose}>
            <ModalDialog variant="outlined" role="alertdialog">
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WarningIcon color={color as any} />
                    {title}
                </DialogTitle>
                <Divider />
                <DialogContent>
                    {message}
                </DialogContent>
                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
                    <Button
                        variant="plain"
                        color="neutral"
                        onClick={onClose}
                        disabled={loading}
                    >
                        {cancelText}
                    </Button>
                    <Button
                        variant="solid"
                        color={color as any}
                        onClick={onConfirm}
                        loading={loading}
                    >
                        {confirmText}
                    </Button>
                </Box>
            </ModalDialog>
        </Modal>
    );
};

export default ConfirmationModal;
