"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const LOCK_KEY = "friend-app:lock";

/** 端末ロックの設定。この端末のブラウザにだけ保存される */
export interface LockState {
  /** アプリを開くたびに認証を求めるか */
  enabled: boolean;
  /** 登録済みの生体認証のID（base64url）。無ければ生体認証は未設定 */
  biometricCredentialId?: string;
  /** パスコードのSHA-256ハッシュ。無ければパスコードは未設定 */
  passcodeHash?: string;
}

const DEFAULT_LOCK: LockState = { enabled: false };

function reconcile(saved: unknown): LockState {
  if (!saved || typeof saved !== "object") return DEFAULT_LOCK;
  const s = saved as Partial<LockState>;
  return {
    enabled: s.enabled === true,
    biometricCredentialId:
      typeof s.biometricCredentialId === "string" ? s.biometricCredentialId : undefined,
    passcodeHash: typeof s.passcodeHash === "string" ? s.passcodeHash : undefined,
  };
}

function loadLock(): LockState {
  if (typeof window === "undefined") return DEFAULT_LOCK;
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? reconcile(JSON.parse(raw)) : DEFAULT_LOCK;
  } catch {
    return DEFAULT_LOCK;
  }
}

interface LockContextValue {
  lock: LockState;
  /** localStorage からの読み込みが終わったか */
  ready: boolean;
  setLock: (patch: Partial<LockState>) => void;
  /** 生体認証の登録だけを消す。パスコードも無ければロック自体も切る */
  clearBiometric: () => void;
  /** パスコードだけを消す。生体認証も無ければロック自体も切る */
  clearPasscode: () => void;
}

const LockContext = createContext<LockContextValue | null>(null);

const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function LockProvider({ children }: { children: ReactNode }) {
  const [lock, setLockState] = useState<LockState>(loadLock);
  const ready = useSyncExternalStore(neverChanges, onClient, onServer);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
    } catch {
      // 容量超過などは黙って諦める
    }
  }, [lock, ready]);

  const setLock = useCallback((patch: Partial<LockState>) => {
    setLockState((s) => ({ ...s, ...patch }));
  }, []);

  const clearBiometric = useCallback(() => {
    setLockState((s) => {
      const next = { ...s, biometricCredentialId: undefined };
      return next.passcodeHash ? next : { ...next, enabled: false };
    });
  }, []);

  const clearPasscode = useCallback(() => {
    setLockState((s) => {
      const next = { ...s, passcodeHash: undefined };
      return next.biometricCredentialId ? next : { ...next, enabled: false };
    });
  }, []);

  const value = useMemo<LockContextValue>(
    () => ({ lock, ready, setLock, clearBiometric, clearPasscode }),
    [lock, ready, setLock, clearBiometric, clearPasscode],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextValue {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error("useLock は LockProvider の中でしか使えません");
  return ctx;
}
