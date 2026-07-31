"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { BackButton } from "@/components/ui";
import { AFFECTION_LEVELS, affectionLevel } from "@/lib/catalog";
import { useLock } from "@/lib/lock";
import { reconcile, useStore } from "@/lib/store";
import { biometricSupported, hashPasscode, registerBiometric } from "@/lib/webauthn";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-bold text-[#4a4a5a]">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-[#9a9aa8]">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-[#dfe2ea] bg-white px-3.5 py-2.5 text-[15px] " +
  "text-[#2b2b33] outline-none focus:border-pink-cta";

const outlineButtonClass =
  "w-full rounded-xl border border-[#dfe2ea] py-2.5 text-[13px] font-bold text-[#2b2b33]";

/** 端末ロック（Face ID・指紋・パスコード）の設定 */
function LockSection() {
  const { lock, setLock, clearBiometric, clearPasscode } = useLock();
  const supported = biometricSupported();

  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState("");

  const [passInput, setPassInput] = useState("");
  const [passConfirm, setPassConfirm] = useState("");
  const [passError, setPassError] = useState("");

  const setupBiometric = async () => {
    setBioError("");
    setBioBusy(true);
    try {
      const id = await registerBiometric();
      setLock({ biometricCredentialId: id, enabled: true });
    } catch {
      setBioError("設定できませんでした。この端末では使えないかもしれません");
    } finally {
      setBioBusy(false);
    }
  };

  const setupPasscode = async () => {
    setPassError("");
    if (passInput.length < 4) {
      setPassError("4文字以上にしてください");
      return;
    }
    if (passInput !== passConfirm) {
      setPassError("確認用と一致しません");
      return;
    }
    setLock({ passcodeHash: await hashPasscode(passInput), enabled: true });
    setPassInput("");
    setPassConfirm("");
  };

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-[14px] font-bold text-[#2b2b33]">端末ロック</h2>
      <p className="text-[11px] leading-relaxed text-[#9a9aa8]">
        設定すると、アプリを開くたびにFace ID・指紋・パスコードのどれかで認証が必要になります。
      </p>

      {lock.enabled && (
        <div className="flex items-center justify-between rounded-xl bg-[#f0fbf4] px-3.5 py-2.5 text-[12px] text-[#2f8a5c]">
          <span>いまロック中です</span>
          <button
            onClick={() => setLock({ enabled: false })}
            className="font-bold text-[#d9536a]"
          >
            止める
          </button>
        </div>
      )}

      <div className="space-y-2 border-t border-[#eceaf0] pt-3">
        <p className="text-[12px] font-bold text-[#5c5c6b]">Face ID・指紋</p>
        {!supported ? (
          <p className="text-[11px] text-[#9a9aa8]">この端末・ブラウザでは使えないみたいです</p>
        ) : lock.biometricCredentialId ? (
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[#2b2b33]">設定済み</span>
            <button onClick={clearBiometric} className="text-[12px] font-bold text-[#d9536a]">
              解除する
            </button>
          </div>
        ) : (
          <button onClick={setupBiometric} disabled={bioBusy} className={outlineButtonClass}>
            {bioBusy ? "設定中…" : "Face ID・指紋を設定する"}
          </button>
        )}
        {bioError && <p className="text-[11px] text-[#d9536a]">{bioError}</p>}
      </div>

      <div className="space-y-2 border-t border-[#eceaf0] pt-3">
        <p className="text-[12px] font-bold text-[#5c5c6b]">パスコード</p>
        {lock.passcodeHash ? (
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[#2b2b33]">設定済み</span>
            <button onClick={clearPasscode} className="text-[12px] font-bold text-[#d9536a]">
              解除する
            </button>
          </div>
        ) : (
          <>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="4文字以上のパスコード"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="確認のためもう一度"
              value={passConfirm}
              onChange={(e) => setPassConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setupPasscode()}
              className={inputClass}
            />
            <button onClick={setupPasscode} className={outlineButtonClass}>
              パスコードを設定する
            </button>
            {passError && <p className="text-[11px] text-[#d9536a]">{passError}</p>}
          </>
        )}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { state, ready, update, setPersona, removeMemory, resetAll } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");

  if (!ready) return <div className="flex-1 bg-[#12121a]" />;

  const level = affectionLevel(state.affection);
  const p = state.persona;

  const exportData = () => {
    // state.schemaVersion に「どの版の形式か」が入っているので、
    // 読み込む側はこれを見て必要なら変換できる
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `koibito-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const triggerImport = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを選び直しても発火するように
    if (!file) return;
    setImportError("");
    try {
      const parsed = JSON.parse(await file.text());
      if (!confirm("いまのデータを上書きして読み込みます。よろしいですか？")) return;
      update(reconcile(parsed));
    } catch {
      setImportError("読み込めませんでした。ファイルの形式を確認してください");
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f7fa]">
      <header className="safe-top flex items-center gap-3 bg-white px-3 pb-3 shadow-sm">
        <BackButton />
        <h1 className="text-[17px] font-bold text-[#2b2b33]">せってい</h1>
      </header>

      <div className="no-scrollbar flex-1 space-y-5 overflow-y-auto p-4 pb-10">
        {/* ------------------------------ あなた ------------------------------ */}
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-[14px] font-bold text-[#2b2b33]">あなたのこと</h2>
          <Field label="呼ばれたい名前">
            <input
              className={inputClass}
              value={state.userName}
              maxLength={12}
              onChange={(e) => update({ userName: e.target.value })}
            />
          </Field>
          <div className="rounded-xl bg-[#fff4f8] px-3.5 py-2.5 text-[12px] text-[#8a6a76]">
            いまの呼ばれ方は「
            <strong className="text-pink-cta-deep">
              {state.userName}
              {p.honorific}
            </strong>
            」
          </div>
        </section>

        {/* ------------------------------ キャラ ------------------------------ */}
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#2b2b33]">キャラのこと</h2>
            <button
              onClick={() => router.push("/characters")}
              className="rounded-full bg-[#eef4fb] px-3 py-1.5 text-[12px] font-bold text-blue-menu"
            >
              別のキャラにする
            </button>
          </div>

          <Field label="名前">
            <input
              className={inputClass}
              value={p.name}
              maxLength={12}
              onChange={(e) => setPersona({ name: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="一人称">
              <input
                className={inputClass}
                value={p.firstPerson}
                maxLength={8}
                onChange={(e) => setPersona({ firstPerson: e.target.value })}
              />
            </Field>
            <Field label="あなたにつける敬称" hint="空なら呼び捨て">
              <input
                className={inputClass}
                value={p.honorific}
                maxLength={6}
                placeholder="さん / くん / ちゃん"
                onChange={(e) => setPersona({ honorific: e.target.value })}
              />
            </Field>
          </div>

          <Field label="口調" hint="どんな話し方をするか">
            <textarea
              className={`${inputClass} h-24 resize-none leading-relaxed`}
              value={p.speech}
              onChange={(e) => setPersona({ speech: e.target.value })}
            />
          </Field>

          <Field label="性格" hint="どんな人柄か、どう接してほしいか">
            <textarea
              className={`${inputClass} h-28 resize-none leading-relaxed`}
              value={p.personality}
              onChange={(e) => setPersona({ personality: e.target.value })}
            />
          </Field>

          <Field label="ホーム画面のセリフ" hint="1行に1つ。{user} はあなたの呼び方に変わります">
            <textarea
              className={`${inputClass} h-28 resize-none leading-relaxed`}
              value={p.idleLines.join("\n")}
              onChange={(e) =>
                setPersona({ idleLines: e.target.value.split("\n").filter((l) => l.trim()) })
              }
            />
          </Field>
        </section>

        {/* ------------------------------ 好感度 ------------------------------ */}
        <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-[14px] font-bold text-[#2b2b33]">ふたりの関係</h2>
          <p className="text-[13px] text-[#5c5c6b]">
            好感度 <strong className="text-pink-cta-deep">{state.affection}</strong>／Lv.
            {level.level}「{level.label}」
          </p>
          <p className="text-[11px] leading-relaxed text-[#9a9aa8]">
            話しかけるたびに1ずつ上がります。レベルが上がると距離感と話し方が変わります。
          </p>
          <ul className="space-y-1 pt-1">
            {AFFECTION_LEVELS.map((lv) => (
              <li
                key={lv.level}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] ${
                  lv.level === level.level
                    ? "bg-[#fff4f8] font-bold text-pink-cta-deep"
                    : state.affection >= lv.threshold
                      ? "text-[#5c5c6b]"
                      : "text-[#c0c0cc]"
                }`}
              >
                <span className="w-8 shrink-0 tabular-nums">Lv.{lv.level}</span>
                <span className="flex-1">{lv.label}</span>
                <span className="tabular-nums">{lv.threshold}〜</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------ 覚えていること ------------------------------ */}
        <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-[14px] font-bold text-[#2b2b33]">覚えていること</h2>
          <p className="text-[11px] leading-relaxed text-[#9a9aa8]">
            会話の中で好きなもの・約束したことなどが出てくると、ここに自動で増えていきます。
            次の会話で参考にされます。
          </p>
          {state.memories.length === 0 ? (
            <p className="rounded-xl bg-[#f6f7fa] px-3.5 py-2.5 text-[12px] text-[#9a9aa8]">
              まだ何もありません
            </p>
          ) : (
            <ul className="space-y-1.5">
              {state.memories
                .map((m, i) => ({ text: m, index: i }))
                .reverse()
                .map(({ text, index }) => (
                  <li
                    key={index}
                    className="flex items-start justify-between gap-2 rounded-xl bg-[#f6f7fa]
                               px-3.5 py-2.5 text-[12px] leading-relaxed text-[#4a4a5a]"
                  >
                    <span className="flex-1">{text}</span>
                    <button
                      onClick={() => removeMemory(index)}
                      className="shrink-0 text-[11px] font-bold text-[#c0c0cc]"
                      aria-label="この記憶を消す"
                    >
                      ✕
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>

        {/* ------------------------------ 端末ロック ------------------------------ */}
        <LockSection />

        {/* ------------------------------ その他 ------------------------------ */}
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-[14px] font-bold text-[#2b2b33]">データ</h2>
          <p className="text-[11px] leading-relaxed text-[#9a9aa8]">
            会話・見た目・好感度・覚えていることはすべてこの端末のブラウザにだけ保存されます。
            サーバーには残りません。
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={exportData} className={outlineButtonClass}>
              エクスポート
            </button>
            <button onClick={triggerImport} className={outlineButtonClass}>
              インポート
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-[#9a9aa8]">
            性格・口調・覚えていることなどをファイルに書き出したり、
            そのファイルから読み込んで他の端末に移したりできます。
          </p>
          {importError && <p className="text-[11px] text-[#d9536a]">{importError}</p>}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFile}
            className="hidden"
          />

          <button
            onClick={() => {
              if (confirm("すべてのデータを消して最初からやり直しますか？")) {
                resetAll();
                router.push("/");
              }
            }}
            className="w-full rounded-xl border border-[#f0c8d4] bg-white py-3 text-[14px]
                       font-bold text-[#d9536a] active:bg-[#fff4f8]"
          >
            すべてリセットする
          </button>
        </section>
      </div>
    </div>
  );
}
