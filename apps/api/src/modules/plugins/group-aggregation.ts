/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

type GroupRepositoryLike = {
    id?: string;
    name?: string;
    type?: string;
    config?: {
        members?: string[];
        [key: string]: unknown;
    };
};

type GetRepo<TRepo extends GroupRepositoryLike> = (
    id: string,
) => Promise<TRepo | null | undefined>;

type GroupMemberResolver<TRepo extends GroupRepositoryLike, TResult> = (
    memberRepo: TRepo,
    visited: Set<string>,
) => Promise<TResult | null | undefined>;

type GroupMemberErrorHandler = (
    memberId: string,
    memberRepo: GroupRepositoryLike,
    error: unknown,
) => void;

function isRepositoryLike(value: unknown): value is GroupRepositoryLike {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as GroupRepositoryLike;
    return (
        typeof candidate.type === 'string' &&
        (typeof candidate.id === 'string' || typeof candidate.name === 'string')
    );
}

function getVisitKey(repo: GroupRepositoryLike) {
    return repo.id || repo.name;
}

export async function collectGroupMemberResults<
    TRepo extends GroupRepositoryLike,
    TResult,
>(options: {
    repo: TRepo;
    getRepo?: GetRepo<TRepo>;
    resolveMember: GroupMemberResolver<TRepo, TResult>;
    visited?: Set<string>;
    onMemberError?: GroupMemberErrorHandler;
}) {
    const { repo, getRepo, resolveMember, onMemberError } = options;
    const visited = options.visited ?? new Set<string>();
    const visitKey = getVisitKey(repo);

    if (visitKey) {
        if (visited.has(visitKey)) {
            return [] as TResult[];
        }

        visited.add(visitKey);
    }

    const memberIds: string[] = Array.isArray(repo.config?.members)
        ? repo.config.members
        : [];
    const results: TResult[] = [];

    for (const memberId of memberIds) {
        const memberRepo = await getRepo?.(memberId);
        if (!isRepositoryLike(memberRepo)) {
            continue;
        }

        try {
            const result = await resolveMember(memberRepo, visited);
            if (result != null) {
                results.push(result);
            }
        } catch (error) {
            onMemberError?.(memberId, memberRepo, error);
        }
    }

    return results;
}