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
