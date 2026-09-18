"use client";
import Dexie, { type EntityTable } from "dexie";
import type { ChatMessage } from "@/lib/ai/types";
import type { ToolOutput } from "@/lib/tools";

/** A message as stored/rendered in the UI: the wire ChatMessage plus rendering metadata. */
export interface UIMessage extends ChatMessage {
  id: string;
  createdAt: number;
  /** tool outputs keyed by tool_call id (rendered as cards) */
  toolOutputs?: Record<string, ToolOutput & { error?: string }>;
  meta?: { provider?: string; model?: string; usage?: { input: number; output: number }; notices?: string[]; error?: string };
}

export interface Conversation { id: string; title: string; createdAt: number; updatedAt: number; messages: UIMessage[]; projectId?: string }
export interface Project { id: string; name: string; description?: string; createdAt: number }
export interface SavedDrawing { id: string; title: string; createdAt: number; drawing: unknown; svg: string; conversationId?: string }

class CivilDB extends Dexie {
  conversations!: EntityTable<Conversation, "id">;
  projects!: EntityTable<Project, "id">;
  drawings!: EntityTable<SavedDrawing, "id">;
  constructor() {
    super("civil-ai");
    this.version(1).stores({ conversations: "id, updatedAt, projectId", projects: "id, createdAt", drawings: "id, createdAt, conversationId" });
  }
}

export const db = typeof window !== "undefined" ? new CivilDB() : (null as unknown as CivilDB);
