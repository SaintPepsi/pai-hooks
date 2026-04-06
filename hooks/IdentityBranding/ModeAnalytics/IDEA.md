# Mode Analytics

> Track which operational modes an AI uses across sessions and visualize trends.

## Problem

AI systems that operate in multiple modes (deep analysis, quick response, minimal acknowledgment) have no built-in way to track which modes get used and how often. Without this data, you cannot tell if the system is using its full range of capabilities or falling into a single-mode rut.

## Solution

At the end of each session, scan the transcript for mode indicators, update a persistent JSON data store with the session's mode usage, and regenerate an HTML dashboard showing trends over time. The dashboard opens automatically at periodic intervals so the user stays aware of usage patterns.

## How It Works

1. When a session ends, run a data collection script that parses the transcript for mode markers.
2. Append the session's mode data to a persistent JSON store.
3. Run a dashboard generator that reads the JSON store and produces an HTML visualization.
4. Optionally open the dashboard in a browser at a configured interval (e.g., every 25th session).

## Signals

- **Input:** Session end event with transcript data
- **Output:** Updated JSON analytics file and regenerated HTML dashboard
