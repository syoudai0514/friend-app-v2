"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) {
        // クッキーが付いた状態でサーバー側から取り直す
        router.replace("/");
        router.refresh();
      } else {
        setError(true);
        setPasscode("");
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-[#ff8fb2] to-[#f0447c] px-7">
      <div className="w-full rounded-3xl bg-white/95 p-7 shadow-2xl">
        <div className="text-center text-[40px] leading-none text-pink-cta">♥</div>
        <h1 className="mt-3 text-center text-[19px] font-bold text-[#2b2b33]">こいびとアプリ</h1>
        <p className="mt-2 text-center text-[12px] text-[#8a8a9a]">合言葉を入れてください</p>

        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="あいことば"
          autoFocus
          autoComplete="current-password"
          className={`mt-5 w-full rounded-full border-2 bg-white px-5 py-3 text-center
                      text-[16px] text-[#2b2b33] outline-none ${
                        error ? "border-[#e0526a]" : "border-[#ffd0de] focus:border-pink-cta"
                      }`}
        />

        <p className="mt-2 h-4 text-center text-[11px] text-[#e0526a]">
          {error ? "合言葉がちがうみたい" : ""}
        </p>

        <button onClick={submit} disabled={busy || !passcode.trim()} className="cta mt-3">
          {busy ? "確認中…" : "はいる"}
        </button>
      </div>
    </div>
  );
}
