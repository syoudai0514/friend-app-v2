"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLock } from "@/lib/lock";
import { verifyBiometric, verifyPasscode } from "@/lib/webauthn";

/**
 * 端末ロックが有効なあいだ、中身を隠してロック画面を出す。
 * バックグラウンドから戻ってきたときも、また鍵をかけ直す
 */
export function LockGate({ children }: { children: ReactNode }) {
  const { lock, ready } = useLock();
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  // 起動した瞬間だけロック要否を見る。設定画面でいま有効にしたばかりの
  // ときに、その場でロック画面に切り替わってしまわないようにするため
  const lockRef = useRef(lock);
  useEffect(() => {
    lockRef.current = lock;
  });
  const checkedOnStart = useRef(false);
  useEffect(() => {
    if (!ready || checkedOnStart.current) return;
    checkedOnStart.current = true;
    setUnlocked(!lockRef.current.enabled);
  }, [ready]);

  useEffect(() => {
    if (!lock.enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setUnlocked(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [lock.enabled]);

  if (!ready) return null;
  if (!lock.enabled || unlocked) return <>{children}</>;

  const tryBiometric = async () => {
    if (!lock.biometricCredentialId || busy) return;
    setBusy(true);
    setError("");
    const ok = await verifyBiometric(lock.biometricCredentialId);
    setBusy(false);
    if (ok) setUnlocked(true);
    else setError("認証できなかったみたい");
  };

  const submitPasscode = async () => {
    if (!lock.passcodeHash || !input || busy) return;
    setBusy(true);
    setError("");
    const ok = await verifyPasscode(input, lock.passcodeHash);
    setBusy(false);
    if (ok) {
      setUnlocked(true);
      setInput("");
    } else {
      setError("パスコードが違うみたい");
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#0b0b0f] px-8 text-center">
      <div className="text-[42px]">🔒</div>
      <p className="text-[14px] text-white/70">ロック中です</p>
      {error && <p className="text-[12px] text-[#ff8fa3]">{error}</p>}

      {lock.biometricCredentialId && (
        <button onClick={tryBiometric} disabled={busy} className="cta w-full max-w-[280px]">
          {busy ? "確認中…" : "Face ID・指紋で開く"}
        </button>
      )}

      {lock.passcodeHash && (
        <div className="w-full max-w-[280px] space-y-2.5">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPasscode()}
            placeholder="パスコード"
            className="w-full rounded-full border-2 border-white/25 bg-white/10 px-5 py-3
                       text-center text-[16px] text-white outline-none focus:border-pink-cta"
          />
          <button onClick={submitPasscode} disabled={busy || !input} className="cta">
            開ける
          </button>
        </div>
      )}
    </div>
  );
}
