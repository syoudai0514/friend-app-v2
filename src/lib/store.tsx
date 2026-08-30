"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEFAULT_LOOK } from "./catalog";
import { applyConversationTransaction, ConversationTransactionLedger } from "./conversation-transaction";
import { DEFAULT_PERSONA, PRESETS } from "./personas";
import type { AppState, ChatMessage, Look, ModelTurn, Persona, PersonaSave, VoiceSettings } from "./types";

const STORAGE_KEY = "friend-app:v2";
const SCHEMA_VERSION = 2;
const MAX_MEMORIES = 40;
const DEFAULT_VOICE: VoiceSettings = { enabled: false, autoplay: false };

const INITIAL: AppState = {
  schemaVersion: SCHEMA_VERSION,
  onboarded: false,
  userName: "あなた",
  persona: DEFAULT_PERSONA,
  look: DEFAULT_LOOK,
  affection: 0,
  messages: [],
  memories: [],
  personas: {},
  voice: DEFAULT_VOICE,
};

const OUTFIT_TO_VARIANT: Record<string, string> = {};

function migrateLook(saved: unknown): Look {
  if (!saved || typeof saved !== "object") return DEFAULT_LOOK;
  const o = saved as Record<string, unknown>;
  const scene = typeof o.scene === "string" ? o.scene : DEFAULT_LOOK.scene;
  const outfit = typeof o.outfit === "string" ? o.outfit : undefined;
  const variantId = (outfit && OUTFIT_TO_VARIANT[outfit]) || DEFAULT_LOOK.variantId;
  return { variantId, scene, motionId: DEFAULT_LOOK.motionId };
}

function reconcileLook(saved: unknown, schemaVersion: number): Look {
  if (schemaVersion < 2) return migrateLook(saved);
  const raw = (saved ?? {}) as Partial<Look>;
  const partRef = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const ref = value as Record<string, unknown>;
    return typeof ref.personaId === "string" && typeof ref.variantId === "string"
      ? { personaId: ref.personaId, variantId: ref.variantId }
      : null;
  };
  return {
    ...DEFAULT_LOOK,
    ...raw,
    outfit: partRef(raw.outfit),
    hair: partRef(raw.hair),
    iris: partRef(raw.iris),
    brows: partRef(raw.brows),
    mouth: partRef(raw.mouth),
  };
}

/** optional fieldsだけを加算的に復元し、未知のruntime metadataは保存へ持ち込まない。 */
function reconcileMessages(saved: unknown): ChatMessage[] {
  if (!Array.isArray(saved)) return [];
  const messages: ChatMessage[] = [];
  for (const value of saved) {
    if (!value || typeof value !== "object") continue;
    const raw = value as Record<string, unknown>;
    if ((raw.role !== "user" && raw.role !== "model") || typeof raw.text !== "string") continue;
    const at = typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : Date.now();
    messages.push({
      role: raw.role,
      text: raw.text,
      at,
      ...(typeof raw.narration === "string" && raw.narration.trim()
        ? { narration: raw.narration.trim().slice(0, 80) }
        : {}),
      ...(raw.performance && typeof raw.performance === "object"
        ? { performance: raw.performance as ChatMessage["performance"] }
        : {}),
    });
  }
  return messages;
}

function reconcilePersonaSave(saved: unknown, schemaVersion: number): PersonaSave | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as Partial<PersonaSave>;
  if (!s.persona || typeof s.persona !== "object") return null;
  return {
    persona: { ...DEFAULT_PERSONA, ...s.persona } as Persona,
    look: reconcileLook(s.look, schemaVersion),
    affection: typeof s.affection === "number" ? s.affection : 0,
    messages: reconcileMessages(s.messages),
    memories: Array.isArray(s.memories) ? s.memories.filter((m) => typeof m === "string") : [],
  };
}

export function reconcile(saved: unknown): AppState {
  if (!saved || typeof saved !== "object") return INITIAL;
  const s = saved as Partial<AppState>;
  const schemaVersion = typeof s.schemaVersion === "number" ? s.schemaVersion : 1;
  const personas: Record<string, PersonaSave> = {};
  if (s.personas && typeof s.personas === "object") {
    for (const [id, value] of Object.entries(s.personas as Record<string, unknown>)) {
      const reconciled = reconcilePersonaSave(value, schemaVersion);
      if (reconciled) personas[id] = reconciled;
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    onboarded: s.onboarded === true,
    userName: typeof s.userName === "string" && s.userName ? s.userName : INITIAL.userName,
    persona: { ...DEFAULT_PERSONA, ...(s.persona ?? {}) } as Persona,
    look: reconcileLook(s.look, schemaVersion),
    affection: typeof s.affection === "number" ? s.affection : 0,
    messages: reconcileMessages(s.messages),
    memories: Array.isArray(s.memories) ? s.memories.filter((m) => typeof m === "string") : [],
    personas,
    voice: {
      enabled: s.voice?.enabled === true,
      autoplay: s.voice?.autoplay === true,
    },
  };
}

interface StoreValue {
  state: AppState;
  ready: boolean;
  update: (patch: Partial<AppState>) => void;
  setLook: (patch: Partial<Look>) => void;
  setPersona: (patch: Partial<Persona>) => void;
  addMessage: (message: ChatMessage) => void;
  /** legacy互換。新しいchat streaming draftからは使用禁止。 */
  replaceLastModel: (text: string) => void;
  gainAffection: (amount: number) => void;
  addMemory: (text: string) => void;
  /** turn_complete専用。model/memory/affectionを同じsetStateで一度だけ確定する。 */
  commitModelTurn: (turnId: string, expectedPersonaId: string, turn: ModelTurn) => boolean;
  setVoiceSettings: (patch: Partial<VoiceSettings>) => void;
  removeMemory: (index: number) => void;
  applyPreset: (presetId: string) => void;
  clearMessages: () => void;
  resetAll: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function loadState(): AppState {
  if (typeof window === "undefined") return INITIAL;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? reconcile(JSON.parse(raw)) : INITIAL;
  } catch {
    return INITIAL;
  }
}

const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const stateRef = useRef(state);
  const transactionLedger = useRef(new ConversationTransactionLedger());
  const ready = useSyncExternalStore(neverChanges, onClient, onServer);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 容量超過でも会話は継続する。
    }
  }, [state, ready]);

  const update = useCallback((patch: Partial<AppState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const setLook = useCallback((patch: Partial<Look>) => {
    setState((current) => ({ ...current, look: { ...current.look, ...patch } }));
  }, []);

  const setPersona = useCallback((patch: Partial<Persona>) => {
    setState((current) => ({ ...current, persona: { ...current.persona, ...patch } }));
  }, []);

  const addMessage = useCallback((message: ChatMessage) => {
    setState((current) => ({ ...current, messages: [...current.messages, message] }));
  }, []);

  const replaceLastModel = useCallback((text: string) => {
    setState((current) => {
      const messages = [...current.messages];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "model") {
          messages[index] = { ...messages[index], text };
          break;
        }
      }
      return { ...current, messages };
    });
  }, []);

  const gainAffection = useCallback((amount: number) => {
    setState((current) => ({ ...current, affection: current.affection + amount }));
  }, []);

  const addMemory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((current) => {
      const rest = current.memories.filter((memory) => memory !== trimmed);
      return { ...current, memories: [...rest, trimmed].slice(-MAX_MEMORIES) };
    });
  }, []);

  const commitModelTurn = useCallback(
    (turnId: string, expectedPersonaId: string, turn: ModelTurn): boolean => {
      const current = stateRef.current;
      if (
        current.persona.id !== expectedPersonaId ||
        !transactionLedger.current.accept(turnId)
      ) {
        return false;
      }
      setState((snapshot) => {
        if (snapshot.persona.id !== expectedPersonaId) {
          transactionLedger.current.release(turnId);
          return snapshot;
        }
        return applyConversationTransaction(snapshot, turn);
      });
      return true;
    },
    [],
  );

  const setVoiceSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setState((current) => ({ ...current, voice: { ...current.voice, ...patch } }));
  }, []);

  const removeMemory = useCallback((index: number) => {
    setState((current) => ({
      ...current,
      memories: current.memories.filter((_, memoryIndex) => memoryIndex !== index),
    }));
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = PRESETS.find((candidate) => candidate.persona.id === presetId);
    if (!preset) return;
    setState((current) => {
      if (presetId === current.persona.id) return current;
      const personas: Record<string, PersonaSave> = {
        ...current.personas,
        [current.persona.id]: {
          persona: current.persona,
          look: current.look,
          affection: current.affection,
          messages: current.messages,
          memories: current.memories,
        },
      };
      const saved = personas[presetId];
      return {
        ...current,
        persona: saved ? saved.persona : preset.persona,
        look: saved ? saved.look : preset.look,
        affection: saved ? saved.affection : 0,
        messages: saved ? saved.messages : [],
        memories: saved ? saved.memories : [],
        personas,
      };
    });
  }, []);

  const clearMessages = useCallback(() => {
    setState((current) => ({ ...current, messages: [] }));
  }, []);

  const resetAll = useCallback(() => {
    transactionLedger.current.clear();
    setState(INITIAL);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      ready,
      update,
      setLook,
      setPersona,
      addMessage,
      replaceLastModel,
      gainAffection,
      addMemory,
      commitModelTurn,
      setVoiceSettings,
      removeMemory,
      applyPreset,
      clearMessages,
      resetAll,
    }),
    [
      state,
      ready,
      update,
      setLook,
      setPersona,
      addMessage,
      replaceLastModel,
      gainAffection,
      addMemory,
      commitModelTurn,
      setVoiceSettings,
      removeMemory,
      applyPreset,
      clearMessages,
      resetAll,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore は AppStateProvider の中でしか使えません");
  return context;
}
