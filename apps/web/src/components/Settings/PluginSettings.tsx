import { useEffect, useState } from 'react';
import { Typography, Card, CardContent, Divider, List, ListItem, ListItemContent, Chip } from '@mui/joy';

import axios from 'axios';

export default function PluginSettings() {
    const [plugins, setPlugins] = useState<any[]>([]);

    const fetchPlugins = () => {
        axios.get('/api/plugins').then(res => setPlugins(res.data)).catch(() => { });
    };

    useEffect(() => {
        fetchPlugins();
    }, []);



    return (
        <Card variant="outlined">
            <CardContent>
                <Typography level="title-md">Plugins</Typography>
                <Typography level="body-sm" sx={{ mb: 2 }}>Active system plugins.</Typography>
                <Divider />
                <List sx={{ '--ListItem-paddingY': '0.75rem', '--ListItem-paddingX': '1rem' }}>
                    {plugins.map((p: any) => (
                        <ListItem
                            key={p.name}
                            sx={{
                                borderRadius: 'sm',
                                mb: 0.5,
                                '&:hover': {
                                    bgcolor: 'background.level1'
                                }
                            }}
                        >
                            <ListItemContent>
                                <Typography level="title-sm">{p.name}</Typography>
                                <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                    Version: <strong>{p.version}</strong>
                                </Typography>
                            </ListItemContent>
                            <Chip size="sm" color="success" variant="soft">Active</Chip>
                        </ListItem>
                    ))}
                    {plugins.length === 0 && (
                        <ListItem sx={{ justifyContent: 'center', py: 4 }}>
                            <Typography level="body-sm" color="neutral">No plugins loaded</Typography>
                        </ListItem>
                    )}
                </List>
            </CardContent>
        </Card>
    );
}
