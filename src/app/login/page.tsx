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
    <div className="flex flex-1 items-center justify-center bg-[#243247] px-7">
      <div className="w-full rounded-3xl bg-white/95 p-7 shadow-2xl">
        <svg
          viewBox="0 0 64 48"
          aria-hidden="true"
          className="mx-auto h-12 w-16"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        >
          <path d="M15 8h25a10 10 0 0 1 10 10v3a10 10 0 0 1-10 10H27l-11 8 3-8h-4A10 10 0 0 1 5 21v-3A10 10 0 0 1 15 8Z" stroke="#243247" />
          <path d="M43 19h6a10 10 0 0 1 10 10v1a10 10 0 0 1-10 10h-3l2 6-9-6h-5" stroke="#70b7e8" />
        </svg>
        <h1 className="mt-3 text-center text-[19px] font-bold text-[#2b2b33]">フレンド</h1>
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
                        error ? "border-[#e0526a]" : "border-[#b8c4d4] focus:border-[#5278a8]"
                      }`}
        />

        <p className="mt-2 h-4 text-center text-[11px] text-[#e0526a]">
          {error ? "合言葉がちがうみたい" : ""}
        </p>

        <button
          onClick={submit}
          disabled={busy || !passcode.trim()}
          className="mt-3 w-full rounded-full bg-[#243247] py-3 text-[16px] font-bold text-white shadow-md transition active:scale-[.98] disabled:opacity-45"
        >
          {busy ? "確認中…" : "はいる"}
        </button>
      </div>
    </div>
  );
}
