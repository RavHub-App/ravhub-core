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
