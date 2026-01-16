import { useState } from 'react';
import { Typography, Card, CardContent, Button, Stack, FormControl, FormLabel, Input, LinearProgress, Box } from '@mui/joy';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useNotification } from '../NotificationSystem';
import axios from 'axios';

interface RepoUploadProps {
    repoId: string;
}

export default function RepoUpload({ repoId }: RepoUploadProps) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const { notify } = useNotification();

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        setProgress(0);

        const formData = new FormData();
        formData.append('file', file);

        try {
            await axios.post(`/api/repository/${repoId}/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.total) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        setProgress(percentCompleted);
                    }
                },
            });
            notify('Upload successful!');
            setFile(null);
        } catch (err) {
            console.error(err);
            notify('Upload failed. Please check repository logs.');
        } finally {
            setUploading(false);
        }
    };

    return (
        <Card variant="outlined">
            <CardContent>
                <Typography level="title-md" sx={{ mb: 2 }}>Upload Package</Typography>

                <Stack spacing={2}>
                    <FormControl>
                        <FormLabel>Select File</FormLabel>
                        <Button
                            component="label"
                            role={undefined}
                            tabIndex={-1}
                            variant="outlined"
                            color="neutral"
                            startDecorator={<CloudUploadIcon />}
                        >
                            {file ? file.name : 'Choose file'}
                            <Input
                                type="file"
                                sx={{ display: 'none' }}
                                onChange={handleFileChange}
                            />
                        </Button>
                    </FormControl>

                    {uploading && (
                        <Box>
                            <LinearProgress determinate value={progress} />
                            <Typography level="body-xs" sx={{ mt: 0.5 }}>{progress}%</Typography>
                        </Box>
                    )}

                    <Button onClick={handleUpload} disabled={!file || uploading} loading={uploading}>
                        Upload
                    </Button>
                </Stack>
            </CardContent>
        </Card>
    );
}
