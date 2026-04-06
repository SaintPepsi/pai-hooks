# Message Queue Server

> Launch a local HTTP server at session start that accepts messages from a coordination daemon.

## Problem

Agents in a multi-agent system need a way to receive messages pushed by a coordinator. The coordinator knows agent thread IDs but has no way to deliver messages directly into an agent's context. The agent needs a local endpoint that can accept and queue incoming messages.

## Solution

At session start, spawn a detached HTTP server process that listens on an auto-assigned port and writes the port number to a known location. The coordination daemon can then push messages to this endpoint. Pair this with a watcher process that polls for new messages and a relay hook that injects them into context.

## How It Works

1. On session start, check if a coordination daemon URL is configured (skip silently if not -- this session is not coordinated).
2. Check if a server is already running for this session to avoid duplicates.
3. Spawn a detached HTTP server process, passing the session ID as an argument.
4. The server auto-assigns a port and writes it to a known file path so the daemon can discover it.
5. Return context instructing the agent to start a watcher process that will listen for incoming messages.

## Signals

- **Input:** Session start event when a coordination daemon is configured
- **Output:** A spawned HTTP server process and context telling the agent how to start listening for messages

## Context

This is the infrastructure layer of a three-part messaging system: server (accepts messages), watcher (blocks until one arrives), and relay (injects it into context).
