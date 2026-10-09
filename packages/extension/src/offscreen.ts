/** Offscreen document: hosts the AI worker. Only chrome.runtime messaging is available here. */

import type { AiRequest, AiWarmup } from "./messages";

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (r: { col?: number; error?: string }) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(chrome.runtime.getURL("ai-worker.js"), { type: "module" });
  worker.onmessage = (ev: MessageEvent<{ id: number; col?: number; error?: string }>) => {
    waiting.get(ev.data.id)?.(ev.data);
    waiting.delete(ev.data.id);
  };
  return worker;
}

chrome.runtime.onMessage.addListener((msg: AiRequest | AiWarmup, sender, sendResponse) => {
  if (msg?.target !== "offscreen" || sender.id !== chrome.runtime.id) return false;
  if (msg.type === "c4:ai-warm") {
    getWorker();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type !== "c4:ai") return false;
  const id = ++seq;
  waiting.set(id, sendResponse);
  getWorker().postMessage({ id, moves: msg.moves, difficulty: msg.difficulty });
  return true;
});
