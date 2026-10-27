/*
  The score library: files you've opened, and the settings you used with each.
  Stored in IndexedDB, the browser's built-in database. idb-keyval wraps it
  into get/set calls so we don't deal with IndexedDB's own clumsy API.
  Nothing leaves the machine; clearing site data in the browser wipes it.
*/
import { get, set, del, createStore } from "idb-keyval";
import type { Hands, Loop } from "./usePlayer";

export type ScoreSettings = {
  bpm?: number;
  hands?: Hands;
  loop?: Loop;
  metronome?: boolean;
  countIn?: boolean;
  waitMode?: boolean;
};

export type ScoreEntry = {
  id: string;
  name: string;
  addedAt: number;
  settings: ScoreSettings;
};

const store = createStore("piano-app", "scores");
const INDEX_KEY = "index";          // list of entries (without file content)
const LAST_KEY = "last-opened";
const contentKey = (id: string) => `content:${id}`;

export async function listScores(): Promise<ScoreEntry[]> {
  return (await get<ScoreEntry[]>(INDEX_KEY, store)) ?? [];
}

export async function addScore(name: string, content: string): Promise<ScoreEntry> {
  const entries = await listScores();
  // Same file name again: replace the content, keep the settings.
  const existing = entries.find((e) => e.name === name);
  const entry: ScoreEntry = existing ?? { id: crypto.randomUUID(), name, addedAt: Date.now(), settings: {} };
  await set(contentKey(entry.id), content, store);
  if (!existing) await set(INDEX_KEY, [...entries, entry], store);
  return entry;
}

export async function getContent(id: string): Promise<string | undefined> {
  return get<string>(contentKey(id), store);
}

export async function removeScore(id: string): Promise<void> {
  const entries = await listScores();
  await set(INDEX_KEY, entries.filter((e) => e.id !== id), store);
  await del(contentKey(id), store);
}

export async function saveSettings(id: string, settings: ScoreSettings): Promise<void> {
  const entries = await listScores();
  await set(INDEX_KEY, entries.map((e) => (e.id === id ? { ...e, settings } : e)), store);
}

export async function getLastOpened(): Promise<string | undefined> {
  return get<string>(LAST_KEY, store);
}

export async function setLastOpened(id: string): Promise<void> {
  await set(LAST_KEY, id, store);
}
