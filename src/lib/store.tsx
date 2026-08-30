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

/** 覚えておく要点は増えすぎないよう、直近のものだけ残す */
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

/**
 * v1の look.outfit -> v2の variantId 対応表。
 * まだVRoidで衣装別のVRMを書き出していないため空。Phase 4で埋める
 */
const OUTFIT_TO_VARIANT: Record<string, string> = {};

/**
 * v1形式のlookをv2形式へ変換する。
 * v1のhair/eyes/mouthなどVRMで意味を持たない項目は捨て、
 * scene（IDの体系は共通のまま）はそのまま引き継ぐ
 */
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

/** 保存済みキャラ1件分。壊れていたら null を返し、丸ごと読み飛ばせるようにする */
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

/**
 * 保存済みデータに欠けたキーがあっても壊れないようにする。
 * エクスポートしたJSONの読み込み（v1エクスポートも含む）にも使う
 */
export function reconcile(saved: unknown): AppState {
  if (!saved || typeof saved !== "object") return INITIAL;
  const s = saved as Partial<AppState>;
  // v1が書き出したJSONにはschemaVersionが無いので、その場合は1とみなす
  const schemaVersion = typeof s.schemaVersion === "number" ? s.schemaVersion : 1;
  const personas: Record<string, PersonaSave> = {};
  if (s.personas && typeof s.personas === "object") {
    for (const [id, v] of Object.entries(s.personas as Record<string, unknown>)) {
      const r = reconcilePersonaSave(v, schemaVersion);
      if (r) personas[id] = r;
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
  /** localStorage からの読み込みが終わったか */
  ready: boolean;
  update: (patch: Partial<AppState>) => void;
  setLook: (patch: Partial<Look>) => void;
  setPersona: (patch: Partial<Persona>) => void;
  addMessage: (m: ChatMessage) => void;
  /** legacy互換。新しいchat streaming draftからは使用禁止。 */
  replaceLastModel: (text: string) => void;
  gainAffection: (n: number) => void;
  /** 会話から覚えた要点を1つ追加する。増えすぎたら古いものから消える */
  addMemory: (text: string) => void;
  /** turn_complete専用。model/memory/affectionを同じsetStateで一度だけ確定する。 */
  commitModelTurn: (turnId: string, expectedPersonaId: string, turn: ModelTurn) => boolean;
  setVoiceSettings: (patch: Partial<VoiceSettings>) => void;
  /** 覚えた要点を1つ消す */
  removeMemory: (index: number) => void;
  applyPreset: (presetId: string) => void;
  clearMessages: () => void;
  resetAll: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

/** localStorage から読み込む。サーバー側では実行されない */
function loadState(): AppState {
  if (typeof window === "undefined") return INITIAL;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? reconcile(JSON.parse(raw)) : INITIAL;
  } catch {
    // 壊れたデータは無視して初期値のまま進む
    return INITIAL;
  }
}

/* ハイドレーションが済んだかを知るための最小限のストア。
   サーバーでは false、クライアントに渡ったあとは true を返す。 */
const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function AppStateProvider({ children }: { children: ReactNode }) {
  // 初回描画で localStorage を読む。サーバーとの描画のズレは
  // ready が false のあいだ各画面が待つことで防いでいる
  const [state, setState] = useState<AppState>(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const transactionLedger = useRef(new ConversationTransactionLedger());
  const ready = useSyncExternalStore(neverChanges, onClient, onServer);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 容量超過などは黙って諦める（会話は続けられる）
    }
  }, [state, ready]);

  const update = useCallback((patch: Partial<AppState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const setLook = useCallback((patch: Partial<Look>) => {
    setState((s) => ({ ...s, look: { ...s.look, ...patch } }));
  }, []);

  const setPersona = useCallback((patch: Partial<Persona>) => {
    setState((s) => ({ ...s, persona: { ...s.persona, ...patch } }));
  }, []);

  const addMessage = useCallback((m: ChatMessage) => {
    setState((s) => ({ ...s, messages: [...s.messages, m] }));
  }, []);

  const replaceLastModel = useCallback((text: string) => {
    setState((s) => {
      const messages = [...s.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "model") {
          messages[i] = { ...messages[i], text };
          break;
        }
      }
      return { ...s, messages };
    });
  }, []);

  const gainAffection = useCallback((n: number) => {
    setState((s) => ({ ...s, affection: s.affection + n }));
  }, []);

  const addMemory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((s) => {
      const rest = s.memories.filter((m) => m !== trimmed);
      const memories = [...rest, trimmed].slice(-MAX_MEMORIES);
      return { ...s, memories };
    });
  }, []);

  const commitModelTurn = useCallback((turnId: string, expectedPersonaId: string, turn: ModelTurn): boolean => {
    const current = stateRef.current;
    if (current.persona.id !== expectedPersonaId || !transactionLedger.current.accept(turnId)) return false;
    setState((s) => {
      if (s.persona.id !== expectedPersonaId) {
        transactionLedger.current.release(turnId);
        return s;
      }
      const next = applyConversationTransaction(s, turn);
      stateRef.current = next;
      return next;
    });
    return true;
  }, []);

  const setVoiceSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setState((s) => ({ ...s, voice: { ...s.voice, ...patch } }));
  }, []);

  const removeMemory = useCallback((index: number) => {
    setState((s) => ({ ...s, memories: s.memories.filter((_, i) => i !== index }));
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = PRESETS.find((p) => p.persona.id === presetId);
    if (!preset) return;
    setState((s) => {
      if (presetId === s.persona.id) return s;
      const personas: Record<string, PersonaSave> = {
        ...s.personas,
        [s.persona.id]: {
          persona: s.persona,
          look: s.look,
          affection: s.affection,
          messages: s.messages,
          memories: s.memories,
        },
      };
      const saved = personas[presetId];
      return {
        ...s,
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
    setState((s) => ({ ...s, messages: [] }));
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
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore は AppStateProvider の中でしか使えません");
  return ctx;
}
