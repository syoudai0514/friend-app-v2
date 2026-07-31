"use client";

import { useRouter } from "next/navigation";
import { CharacterStage } from "@/components/character/CharacterStage";
import { BackButton } from "@/components/ui";
import { PRESETS } from "@/lib/personas";
import { useStore } from "@/lib/store";

export default function CharactersPage() {
  const router = useRouter();
  const { state, ready, applyPreset } = useStore();

  if (!ready) return <div className="flex-1 bg-[#12121a]" />;

  const choose = (id: string, name: string) => {
    if (id === state.persona.id) {
      router.push("/");
      return;
    }
    if (
      confirm(
        `${name}に切り替えますか？\n見た目・性格・会話・好感度はキャラごとに保存されるので、\n今のキャラの分はそのまま残ります。`,
      )
    ) {
      applyPreset(id);
      router.push("/");
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f7fa]">
      <header className="safe-top flex items-center gap-3 bg-white px-3 pb-3 shadow-sm">
        <BackButton />
        <h1 className="text-[17px] font-bold text-[#2b2b33]">キャラをえらぶ</h1>
      </header>

      <p className="px-4 pt-3 pb-1 text-[12px] leading-relaxed text-[#7a7a8c]">
        見た目も性格も、あとからクローゼットとせっていで自由に変えられます。
      </p>

      <div className="no-scrollbar grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-3">
        {PRESETS.map(({ persona, look }) => {
          const current = persona.id === state.persona.id;
          return (
            <button
              key={persona.id}
              onClick={() => choose(persona.id, persona.name)}
              className={`relative flex h-[302px] flex-col overflow-hidden rounded-2xl border-2
                          bg-white text-left shadow-sm transition active:scale-95 ${
                            current ? "border-pink-cta" : "border-transparent"
                          }`}
            >
              <div className="relative h-56 w-full shrink-0 overflow-hidden">
                <CharacterStage look={look} personaId={persona.id} />
                {current && (
                  <span
                    className="absolute top-2 left-2 rounded-full bg-pink-cta px-2.5 py-1
                               text-[10px] font-bold text-white shadow"
                  >
                    いま一緒
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <div className="text-[15px] font-bold text-[#2b2b33]">{persona.name}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#8a8a9a]">
                  {persona.personality}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
