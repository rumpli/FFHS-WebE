/**
 * lobby.ts
 *
 * WebSocket handlers for lobby interactions: subscribing to lobby state and
 * updating lobby-specific preferences (deck selection, ready state). These
 * are thin wrappers around DB queries and broadcasting lobby state updates.
 */

import type {WebSocket} from 'ws';
import type {ClientMsg} from '../protocol.js';
import {prisma} from '../../db/prisma.js';
import {joinRoom, broadcastRoom, send} from '../registry.js';

const lobbyRoom = (lobbyId: string) => `lobby:${lobbyId}`;

export async function handleLobbySubscribe(ws: WebSocket, connId: string, msg: Extract<ClientMsg, {
    type: 'LOBBY_SUBSCRIBE'
}>, _userId: string | null) {
    if (!msg.lobbyId) return send(ws, {type: 'ERROR', code: 'LOBBY_ID_REQUIRED'});
    const lobbyId = msg.lobbyId;
    const lobby = await prisma.lobby.findUnique({
        where: {id: lobbyId},
        include: {
            players: {include: {user: {select: {id: true, username: true}}}},
            owner: {select: {id: true, username: true}}
        }
    });
    if (!lobby) return send(ws, {type: 'ERROR', code: 'NOT_FOUND'});
    joinRoom(connId, lobbyRoom(lobbyId));
    send(ws, {type: 'LOBBY_STATE', lobby});
}

export async function handleLobbySetDeck(ws: WebSocket, connId: string, msg: Extract<ClientMsg, {
    type: 'LOBBY_SET_DECK'
}>, userId: string | null) {
    if (!userId) return send(ws, {type: 'ERROR', code: 'AUTH_REQUIRED'});
    const {lobbyId, deckId} = msg as any;
    if (!lobbyId) return send(ws, {type: 'ERROR', code: 'LOBBY_ID_REQUIRED'});
    const member = await prisma.lobbyPlayer.findFirst({where: {lobbyId, userId}});
    if (!member) return send(ws, {type: 'ERROR', code: 'NOT_IN_LOBBY'});
    if (deckId) {
        const deck = await prisma.deck.findUnique({where: {id: deckId}});
        if (!deck) return send(ws, {type: 'ERROR', code: 'DECK_NOT_FOUND'});
        const ownerId = (deck as any).ownerId as string | undefined;
        if (ownerId && ownerId !== userId) return send(ws, {type: 'ERROR', code: 'DECK_NOT_OWNED'});
    }
    await prisma.lobbyPlayer.update({where: {id: member.id}, data: {deckId} as any});
    const updated = await prisma.lobby.findUnique({
        where: {id: lobbyId},
        include: {
            players: {include: {user: {select: {id: true, username: true}}}},
            owner: {select: {id: true, username: true}}
        }
    });
    broadcastRoom(lobbyRoom(lobbyId), {type: 'LOBBY_STATE', lobby: updated});
}

export async function handleLobbySetReady(ws: WebSocket, connId: string, msg: Extract<ClientMsg, {
    type: 'LOBBY_SET_READY'
}>, userId: string | null) {
    if (!userId) return send(ws, {type: 'ERROR', code: 'AUTH_REQUIRED'});
    const {lobbyId, isReady} = msg as any;
    if (!lobbyId) return send(ws, {type: 'ERROR', code: 'LOBBY_ID_REQUIRED'});
    const member = await prisma.lobbyPlayer.findFirst({where: {lobbyId, userId}});
    if (!member) return send(ws, {type: 'ERROR', code: 'NOT_IN_LOBBY'});
    await prisma.lobbyPlayer.update({where: {id: member.id}, data: {isReady: !!isReady} as any});
    const updated = await prisma.lobby.findUnique({
        where: {id: lobbyId},
        include: {
            players: {include: {user: {select: {id: true, username: true}}}},
            owner: {select: {id: true, username: true}}
        }
    });
    broadcastRoom(lobbyRoom(lobbyId), {type: 'LOBBY_STATE', lobby: updated});
}
